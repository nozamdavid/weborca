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

describe('Orca WASM Engine getConfigDef Test Suite', () => {
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
      threads: 2
    });

    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
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

  test('getConfigDef for layer_height, sparse_infill_pattern and retraction_length equals API-configdef.md examples', async () => {
    const defs = await core.call('getConfigDef', {
      keys: ['layer_height', 'sparse_infill_pattern', 'retraction_length']
    });

    const expectedLayerHeight = {
      category: 'Quality',
      default: '0.2',
      label: 'Layer height',
      min: 0.0,
      mode: 'simple',
      sidetext: 'mm',
      tooltip: 'This is the height for each layer. Smaller layer heights give greater accuracy but longer printing time.',
      type: 'float'
    };

    const expectedSparseInfillPattern = {
      category: 'Strength',
      default: 'crosshatch',
      enumLabels: [
        'Rectilinear',
        'Aligned Rectilinear',
        'Zig Zag',
        'Cross Zag',
        'Locked Zag',
        'Line',
        'Grid',
        'Triangles',
        'Tri-hexagon',
        'Cubic',
        'Adaptive Cubic',
        'Quarter Cubic',
        'Support Cubic',
        'Lightning',
        'Honeycomb',
        '3D Honeycomb',
        'Lateral Honeycomb',
        'Lateral Lattice',
        'Cross Hatch',
        'TPMS-D',
        'TPMS-FK',
        'Gyroid',
        'Concentric',
        'Hilbert Curve',
        'Archimedean Chords',
        'Octagram Spiral'
      ],
      enumValues: [
        'rectilinear',
        'alignedrectilinear',
        'zigzag',
        'crosszag',
        'lockedzag',
        'line',
        'grid',
        'triangles',
        'tri-hexagon',
        'cubic',
        'adaptivecubic',
        'quartercubic',
        'supportcubic',
        'lightning',
        'honeycomb',
        '3dhoneycomb',
        'lateral-honeycomb',
        'lateral-lattice',
        'crosshatch',
        'tpmsd',
        'tpmsfk',
        'gyroid',
        'concentric',
        'hilbertcurve',
        'archimedeanchords',
        'octagramspiral'
      ],
      label: 'Sparse infill pattern',
      mode: 'simple',
      tooltip: 'This is the line pattern for internal sparse infill.',
      type: 'enum'
    };

    const expectedRetractionLength = {
      default: '0.8',
      fullLabel: 'Retraction Length',
      label: 'Length',
      mode: 'simple',
      sidetext: 'mm',
      tooltip: 'Some amount of material in extruder is pulled back to avoid ooze during long travel. Set zero to disable retraction.',
      type: 'floats'
    };

    assert.deepStrictEqual(defs.layer_height, expectedLayerHeight, 'layer_height metadata must match API-configdef.md');
    assert.deepStrictEqual(defs.sparse_infill_pattern, expectedSparseInfillPattern, 'sparse_infill_pattern metadata must match API-configdef.md');
    assert.deepStrictEqual(defs.retraction_length, expectedRetractionLength, 'retraction_length metadata must match API-configdef.md');
  });

  test('getConfigDef with no keys returns more than 500 keys', async () => {
    const allDefs = await core.call('getConfigDef', {});
    assert.ok(typeof allDefs === 'object' && allDefs !== null, 'result must be an object');
    const keyCount = Object.keys(allDefs).length;
    assert.ok(keyCount > 500, `Expected > 500 keys, got ${keyCount}`);
  });

  test('every key in the current getConfig result has a definition', async () => {
    const config = await core.call('getConfig', {});
    const allDefs = await core.call('getConfigDef', {});

    const missingKeys = [];
    for (const key of Object.keys(config)) {
      if (!allDefs[key]) {
        missingKeys.push(key);
      }
    }

    assert.deepStrictEqual(missingKeys, [], `All getConfig keys must have definitions in print_config_def. Missing: ${missingKeys.join(', ')}`);
  });
});
