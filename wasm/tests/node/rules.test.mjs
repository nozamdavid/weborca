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

describe('Orca WASM Engine evaluateRules Test Suite', () => {
  let core;

  before(async () => {
    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const bblJsonPath = path.join(bundleDir, 'profiles', 'BBL.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');

    if (!fs.existsSync(resJsonPath) || !fs.existsSync(voronJsonPath) || !fs.existsSync(bblJsonPath) || !fs.existsSync(orcaFilJsonPath)) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, bundleDir, 'Voron', 'BBL', 'OrcaFilamentLibrary'], {
        stdio: 'inherit'
      });
    }

    const mod = await import(modulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      threads: 2
    });

    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(bblJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('smoothing emits a canonical disabled arc fix for both active arc modes', async () => {
    for (const mode of ['enabled', 'sparse_infill']) {
      await core.call('setOptions', { options: { enable_arc_fitting: mode, max_volumetric_extrusion_rate_slope: '1' } });
      const rules = await core.call('evaluateRules', { kind: 'print' });
      const fix = rules.fixes.find(fix => fix.key === 'enable_arc_fitting');
      assert.equal(fix?.value, 'disabled');
      assert.deepEqual((await core.call('setOptions', { options: { [fix.key]: fix.value } })).errors, []);
      assert.equal((await core.call('getConfig', {})).enable_arc_fitting, 'disabled');
    }
    await core.call('setOptions', { options: { enable_arc_fitting: 'enabled', max_volumetric_extrusion_rate_slope: '0' } });
    assert.ok(!(await core.call('evaluateRules', { kind: 'print' })).fixes.some(fix => fix.key === 'enable_arc_fitting'));
    await core.call('resetOptions', {});
  });

  test('(a) Support rule: ConfigManipulation.cpp:1024-1026 small_support_perimeter options toggled by enable_support', async () => {
    // Both ways: enable_support off (0) -> disabled; enable_support on (1) -> enabled
    await core.call('setOptions', {
      options: {
        enable_support: '0',
        raft_layers: '0'
      }
    });

    let res = await core.call('evaluateRules', { kind: 'print' });
    assert.strictEqual(
      res.fields.small_support_perimeter_speed.enabled,
      false,
      'small_support_perimeter_speed must be disabled when enable_support is 0'
    );
    assert.strictEqual(
      res.fields.small_support_perimeter_threshold.enabled,
      false,
      'small_support_perimeter_threshold must be disabled when enable_support is 0'
    );
    assert.strictEqual(
      res.fields.support_base_pattern.enabled,
      false,
      'support_base_pattern must be disabled when enable_support is 0'
    );

    await core.call('setOptions', {
      options: {
        enable_support: '1'
      }
    });

    res = await core.call('evaluateRules', { kind: 'print' });
    assert.strictEqual(
      res.fields.small_support_perimeter_speed.enabled,
      true,
      'small_support_perimeter_speed must be enabled when enable_support is 1'
    );
    assert.strictEqual(
      res.fields.small_support_perimeter_threshold.enabled,
      true,
      'small_support_perimeter_threshold must be enabled when enable_support is 1'
    );
    assert.strictEqual(
      res.fields.support_base_pattern.enabled,
      true,
      'support_base_pattern must be enabled when enable_support is 1'
    );

    // Clean up overrides
    await core.call('resetOptions', {});
  });

  test('(b) Spiral vase rule: ConfigManipulation.cpp:455-484 spiral_mode generates desktop spiral vase dialog fixes', async () => {
    // Both ways: spiral_mode on (1) produces exact fixes; spiral_mode off (0) produces none
    await core.call('setOptions', {
      options: {
        spiral_mode: '1'
      }
    });

    let res = await core.call('evaluateRules', { kind: 'print' });
    const fixesMap = new Map(res.fixes.map((f) => [f.key, f.value]));

    // Exact keys and values from ConfigManipulation.cpp:468-479
    assert.strictEqual(fixesMap.get('wall_loops'), '1', 'wall_loops must be fixed to 1');
    assert.strictEqual(fixesMap.get('top_shell_layers'), '0', 'top_shell_layers must be fixed to 0');
    assert.strictEqual(fixesMap.get('sparse_infill_density'), '0%', 'sparse_infill_density must be fixed to 0%');
    assert.strictEqual(fixesMap.get('enable_support'), '0', 'enable_support must be fixed to 0');
    assert.strictEqual(fixesMap.get('enforce_support_layers'), '0', 'enforce_support_layers must be fixed to 0');
    assert.strictEqual(fixesMap.get('detect_thin_wall'), '0', 'detect_thin_wall must be fixed to 0');
    assert.strictEqual(fixesMap.get('overhang_reverse'), '0', 'overhang_reverse must be fixed to 0');
    assert.strictEqual(fixesMap.get('timelapse_type'), '0', 'timelapse_type must be fixed to traditional');
    assert.strictEqual(fixesMap.get('enable_wrapping_detection'), '0', 'enable_wrapping_detection must be fixed to 0');
    const yesOptions = Object.fromEntries(res.fixes.filter(f => !f.reason.includes('[No:')).map(f => [f.key, f.value]));
    const applied = await core.call('setOptions', { options: yesOptions });
    assert.deepEqual(applied.errors ?? [], [], 'every proposed Yes fix must be accepted natively');
    const fixedConfig = await core.call('getConfig');
    assert.equal(fixedConfig.timelapse_type, '0');
    assert.equal(fixedConfig.wall_loops, '1');
    assert.equal(fixedConfig.sparse_infill_density, '0%');
    // "No" branch from ConfigManipulation.cpp:484
    assert.strictEqual(fixesMap.get('spiral_mode'), '0', 'spiral_mode "No" branch must be fixed to 0');

    await core.call('setOptions', {
      options: {
        spiral_mode: '0'
      }
    });

    res = await core.call('evaluateRules', { kind: 'print' });
    const spiralFixes = res.fixes.filter((f) => f.key === 'spiral_mode' || f.key === 'wall_loops');
    assert.strictEqual(spiralFixes.length, 0, 'No spiral mode fixes when spiral_mode is 0');

    await core.call('resetOptions', {});
  });

  test('alternate-wall recommendation branches use valid enum values', async () => {
    await core.call('setOptions', { options: { alternate_extra_wall: '1', ensure_vertical_shell_thickness: 'ensure_all' } });
    const result = await core.call('evaluateRules', { kind: 'print' });
    const noBranch = f => /\[No\s*(?::|-)/.test(f.reason);
    for (const no of [false, true]) {
      const options = Object.fromEntries(result.fixes.filter(f => noBranch(f) === no).map(f => [f.key, f.value]));
      assert.ok(Object.keys(options).length);
      const applied = await core.call('setOptions', { options });
      assert.deepEqual(applied.errors ?? [], []);
      const config = await core.call('getConfig');
      assert.equal(config.ensure_vertical_shell_thickness, no ? 'ensure_all' : 'ensure_moderate');
      assert.equal(config.alternate_extra_wall, no ? '0' : '1');
    }
    await core.call('resetOptions', {});
  });

  test('(c) Printer rule: Tab.cpp:6245-6249 scan_first_layer visible for Bambu Lab vs Voron', async () => {
    // Both ways: Voron (non-BBL) vs Bambu Lab (BBL)
    // 1. Voron: scan_first_layer hidden, use_firmware_retraction visible
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    let res = await core.call('evaluateRules', { kind: 'printer' });
    assert.strictEqual(
      res.fields.scan_first_layer.visible,
      false,
      'scan_first_layer must be hidden for Voron printer'
    );
    assert.strictEqual(
      res.fields.use_firmware_retraction.visible,
      true,
      'use_firmware_retraction must be visible for Voron printer'
    );

    // 2. Bambu Lab X1 Carbon: scan_first_layer visible, use_firmware_retraction hidden
    await core.call('selectPresets', {
      printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
      process: '0.20mm Standard @BBL X1C',
      filaments: ['Bambu PLA Basic @BBL X1C']
    });

    res = await core.call('evaluateRules', { kind: 'printer' });
    assert.strictEqual(
      res.fields.scan_first_layer.visible,
      true,
      'scan_first_layer must be visible for Bambu Lab printer'
    );
    assert.strictEqual(
      res.fields.use_firmware_retraction.visible,
      false,
      'use_firmware_retraction must be hidden for Bambu Lab printer'
    );

    // Switch back to Voron
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });
  });

  test('(d) Filament rule: Tab.cpp:4888 overhang and bridge fan speeds toggled by enable_overhang_bridge_fan', async () => {
    // Both ways: enable_overhang_bridge_fan off (0) -> disabled; enable_overhang_bridge_fan on (1) -> enabled
    await core.call('setOptions', {
      options: {
        enable_overhang_bridge_fan: '0'
      }
    });

    let res = await core.call('evaluateRules', { kind: 'filament', filamentIndex: 0 });
    assert.strictEqual(
      res.fields.overhang_fan_speed.enabled,
      false,
      'overhang_fan_speed must be disabled when enable_overhang_bridge_fan is 0'
    );
    assert.strictEqual(
      res.fields.internal_bridge_fan_speed.enabled,
      false,
      'internal_bridge_fan_speed must be disabled when enable_overhang_bridge_fan is 0'
    );

    await core.call('setOptions', {
      options: {
        enable_overhang_bridge_fan: '1'
      }
    });

    res = await core.call('evaluateRules', { kind: 'filament', filamentIndex: 0 });
    assert.strictEqual(
      res.fields.overhang_fan_speed.enabled,
      true,
      'overhang_fan_speed must be enabled when enable_overhang_bridge_fan is 1'
    );
    assert.strictEqual(
      res.fields.internal_bridge_fan_speed.enabled,
      true,
      'internal_bridge_fan_speed must be enabled when enable_overhang_bridge_fan is 1'
    );

    await core.call('resetOptions', {});
  });

  test('(e) Per-extruder key rule: Tab.cpp:6318 retract_length#0 toggled by use_firmware_retraction', async () => {
    // Both ways: use_firmware_retraction off (0) -> enabled; use_firmware_retraction on (1) -> disabled
    await core.call('setOptions', {
      options: {
        use_firmware_retraction: '0'
      }
    });

    let res = await core.call('evaluateRules', { kind: 'printer', filamentIndex: 0 });
    assert.ok(
      res.fields['retract_length#0'],
      'retract_length#0 must exist in evaluated fields for extruder 0'
    );
    assert.strictEqual(
      res.fields['retract_length#0'].enabled,
      true,
      'retract_length#0 must be enabled when use_firmware_retraction is 0'
    );

    await core.call('setOptions', {
      options: {
        use_firmware_retraction: '1'
      }
    });

    res = await core.call('evaluateRules', { kind: 'printer', filamentIndex: 0 });
    assert.strictEqual(
      res.fields['retract_length#0'].enabled,
      false,
      'retract_length#0 must be disabled when use_firmware_retraction is 1'
    );

    await core.call('resetOptions', {});
  });

  test('(f) Enum-driven rule: ConfigManipulation.cpp:1233 infill_overhang_angle toggled by sparse_infill_pattern', async () => {
    // Both ways: sparse_infill_pattern rectilinear -> infill_overhang_angle hidden;
    // sparse_infill_pattern lateral-honeycomb -> infill_overhang_angle visible
    await core.call('setOptions', {
      options: {
        sparse_infill_pattern: 'rectilinear'
      }
    });

    let res = await core.call('evaluateRules', { kind: 'print' });
    assert.strictEqual(
      res.fields.infill_overhang_angle.visible,
      false,
      'infill_overhang_angle must be hidden when sparse_infill_pattern is rectilinear'
    );

    await core.call('setOptions', {
      options: {
        sparse_infill_pattern: 'lateral-honeycomb'
      }
    });

    res = await core.call('evaluateRules', { kind: 'print' });
    assert.strictEqual(
      res.fields.infill_overhang_angle.visible,
      true,
      'infill_overhang_angle must be visible when sparse_infill_pattern is lateral-honeycomb'
    );

    await core.call('resetOptions', {});
  });

  test('(g) RuleContext filament_cnt: matches selected filaments count (ConfigManipulation.cpp:515)', async () => {
    // 1 filament selected
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    let res = await core.call('evaluateRules', { kind: 'print' });
    assert.ok(res.context, 'evaluateRules result must include context');
    assert.strictEqual(
      res.context.filament_cnt,
      1,
      'RuleContext filament_cnt must be 1 when 1 filament preset is selected'
    );

    // 2 filaments selected
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System', 'Generic PETG @System']
    });

    res = await core.call('evaluateRules', { kind: 'print' });
    assert.ok(res.context, 'evaluateRules result must include context');
    assert.strictEqual(
      res.context.filament_cnt,
      2,
      'RuleContext filament_cnt must be 2 when 2 filament presets are selected'
    );

    const expectedKeys = [
      'is_bbl_printer',
      'support_wrapping_detection',
      'support_chamber_temp_control',
      'machine_supports_junction_deviation',
      'single_extruder_multi_material',
      'supports_wipe_tower_2',
      'purge_in_prime_tower',
      'support_parallel_printheads',
      'support_multi_bed_types',
      'printer_model',
      'filament_cnt',
      'extruders_count',
      'curr_bed_type',
      'is_mixed_filament',
      'min_layer_height',
      'max_layer_height',
      'variant_index',
      'is_global_config',
      'is_plate_config',
      'has_variable_layer_height',
      'no_warn_mixed_sublayer_variable_layer'
    ];
    for (const key of expectedKeys) {
      assert.ok(key in res.context, `context.${key} must be defined`);
    }
    assert.strictEqual(Array.isArray(res.context.is_mixed_filament), true);
    assert.strictEqual(res.context.is_mixed_filament.length, 2);

    // Restore to single filament
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });
  });
});
