import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(__dirname, '../../build/orca-wasm64/wasm/engine/orca_engine.mjs');

describe('Engine parsePreset()', () => {
  let core;

  before(async () => {
    const mod = await import(modulePath);
    core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default });
  });

  after(async () => {
    if (core) await core.dispose();
  });

  test('loads a desktop JSON preset losslessly, with metadata and legacy migration', async () => {
    const gcode = '; start, here\nM104 S[nozzle_temperature_initial_layer]';
    const preset = {
      type: 'filament',
      name: 'My PLA',
      inherits: 'Generic PLA @System',
      from: 'User',
      filament_start_gcode: [gcode],
      nozzle_temperature: ['215'],
      filament_colour: ['#FF0000'],
      not_an_orca_option: '1'
    };
    const res = await core.call('parsePreset', { format: 'json', text: JSON.stringify(preset) });

    assert.equal(res.meta.name, 'My PLA');
    assert.equal(res.meta.inherits, 'Generic PLA @System');
    assert.equal(res.config.nozzle_temperature, '215');
    assert.equal(res.config.filament_colour, '#FF0000');
    assert.ok(res.droppedKeys.includes('not_an_orca_option'));
    assert.equal(res.config.not_an_orca_option, undefined);

    // The serialized value must load back to itself: G-code with ';' and ',' survives intact.
    const again = await core.call('parsePreset', {
      format: 'ini',
      text: `filament_start_gcode = ${res.config.filament_start_gcode}`
    });
    assert.equal(again.config.filament_start_gcode, res.config.filament_start_gcode);
    assert.ok(res.config.filament_start_gcode.includes('; start, here'));
  });

  test('migrates legacy keys the way desktop does', async () => {
    const res = await core.call('parsePreset', {
      format: 'ini',
      text: 'enable_wipe_tower = 1\nlayer_height = 0.2'
    });
    assert.equal(res.config.enable_prime_tower, '1');
    assert.equal(res.config.enable_wipe_tower, undefined);
    assert.equal(res.config.layer_height, '0.2');
  });

  test('rejects malformed JSON', async () => {
    await assert.rejects(core.call('parsePreset', { format: 'json', text: '{ not json' }), /Invalid preset JSON/);
  });
});
