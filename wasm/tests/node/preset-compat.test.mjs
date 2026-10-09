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

describe('Preset Compatibility Query Engine Op', () => {
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

  test('getCompatiblePresets filters user presets by printer compatibility', async () => {
    const res = await core.call('getCompatiblePresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      userPresets: [
        {
          name: 'Voron Compatible PLA',
          kind: 'filament',
          inherits: 'Generic PLA @Voron',
          values: { nozzle_temperature: '215' }
        },
        {
          name: 'Bambu Incompatible PLA',
          kind: 'filament',
          inherits: 'Bambu PLA Basic @BBL X1C',
          values: { nozzle_temperature: '220' }
        },
        {
          name: 'Voron Compatible Process',
          kind: 'process',
          inherits: '0.20mm Standard @Voron',
          values: { layer_height: '0.16' }
        },
        {
          name: 'Bambu Incompatible Process',
          kind: 'process',
          inherits: '0.20mm Standard @BBL X1C',
          values: { layer_height: '0.16' }
        }
      ]
    });

    assert.ok(Array.isArray(res.compatibleUserPresets), 'compatibleUserPresets must be an array');
    assert.ok(res.compatibleUserPresets.includes('Voron Compatible PLA'), 'Voron PLA must be compatible');
    assert.ok(res.compatibleUserPresets.includes('Voron Compatible Process'), 'Voron Process must be compatible');
    assert.ok(!res.compatibleUserPresets.includes('Bambu Incompatible PLA'), 'Bambu PLA must NOT be compatible with Voron');
    assert.ok(!res.compatibleUserPresets.includes('Bambu Incompatible Process'), 'Bambu Process must NOT be compatible with Voron');

    assert.ok(Array.isArray(res.compatibleProcesses), 'compatibleProcesses must be an array');
    assert.ok(res.compatibleProcesses.includes('0.20mm Standard @Voron'));
    assert.ok(!res.compatibleProcesses.includes('0.20mm Standard @BBL X1C'));

    assert.ok(Array.isArray(res.compatibleFilaments), 'compatibleFilaments must be an array');
    assert.ok(res.compatibleFilaments.includes('Generic PLA @System'));
  });

  test('user preset with custom compatible_printers override evaluates against printer', async () => {
    const res = await core.call('getCompatiblePresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      userPresets: [
        {
          name: 'Overridden Bambu Filament',
          kind: 'filament',
          inherits: 'Bambu PLA Basic @BBL X1C',
          values: {
            compatible_printers: 'Voron 2.4 300 0.4 nozzle'
          }
        }
      ]
    });

    assert.ok(
      res.compatibleUserPresets.includes('Overridden Bambu Filament'),
      'Overridden filament explicitly listing Voron printer must be marked compatible'
    );
  });

  test('user printer preset resolves through inherited system printer and overrides', async () => {
    const res = await core.call('getCompatiblePresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      printerName: 'My Custom Voron 2.4',
      printerOverrides: {
        printable_height: '350'
      },
      userPresets: [
        {
          name: 'Voron Filament',
          kind: 'filament',
          inherits: 'Generic PLA @Voron',
          values: {}
        },
        {
          name: 'Bambu Filament',
          kind: 'filament',
          inherits: 'Bambu PLA Basic @BBL X1C',
          values: {}
        }
      ]
    });

    assert.ok(res.compatibleUserPresets.includes('Voron Filament'));
    assert.ok(!res.compatibleUserPresets.includes('Bambu Filament'));
  });

  test('calling getCompatiblePresets does not mutate current active selection or compatibility', async () => {
    // Select Voron
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const voronProcessesBefore = await core.call('listPresets', { kind: 'process', compatibleOnly: true });

    // Call getCompatiblePresets for Bambu Lab X1 Carbon
    await core.call('getCompatiblePresets', {
      printer: 'Bambu Lab X1 Carbon 0.4 nozzle'
    });

    // Verify current compatibility is still Voron
    const voronProcessesAfter = await core.call('listPresets', { kind: 'process', compatibleOnly: true });
    assert.deepEqual(
      voronProcessesAfter.map((p) => p.name),
      voronProcessesBefore.map((p) => p.name),
      'Active compatible presets must not be changed by getCompatiblePresets'
    );
  });
});
