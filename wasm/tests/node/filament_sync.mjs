/** Read-only inventory decoding; no printer connections or commands. */
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'orca-filament-sync-'));
try {
  const load = async (name) => {
    const entry = new URL(`../../app/src/printers/${name}.ts`, import.meta.url).pathname;
    const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
    const path = join(dir, `${name}.mjs`);
    await writeFile(path, result.outputFiles[0].text);
    return import(pathToFileURL(path));
  };
  const { deriveBambuFilaments, mergeBambuReport, deriveBambuState } = await load('bambu');
  const report = { ams: { ams: [{ id: '0', tray: [
    { id: '0', tray_type: 'PLA', tray_color: 'FF8800FF', tray_info_idx: 'GFA00' },
    { id: '1', tray_type: '', tray_color: 'FFFFFF00' }
  ] }] }, vt_tray: { tray_type: 'PETG', tray_color: '123456' } };
  const slots = deriveBambuFilaments(report);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].color, '#FF8800');
  assert.equal(slots[1].id, 'external:254');
  const partial = mergeBambuReport(report, { ams: { ams: [{ id: '0', humidity: '3', tray: [{ id: '0', tray_color: '00FF00FF' }] }] } });
  assert.equal(deriveBambuFilaments(partial)[0].material, 'PLA');
  assert.equal(deriveBambuFilaments(partial)[0].color, '#00FF00');
  assert.equal(deriveBambuFilaments(partial)[1].material, 'PETG');
  const removed = mergeBambuReport(partial, { ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: '' }] }] } });
  assert.equal(deriveBambuFilaments(removed).length, 1);
  assert.deepEqual(deriveBambuFilaments({}), []);
  assert.deepEqual(deriveBambuFilaments({ ams: { ams: [{ tray: [null] }] }, vir_slot: [null] }), []);
  assert.equal(deriveBambuFilaments(mergeBambuReport(report, { ams: { ams: [] } })).length, 1, 'explicit empty AMS inventory clears previous trays');
  const hostile = mergeBambuReport({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(hostile.polluted, undefined);
  assert.deepEqual(mergeBambuReport(report, null), report);
  assert.equal(deriveBambuState({}).state, 'unknown');
  assert.equal(deriveBambuState({ gcode_state: 'UNRECOGNIZED' }).message, 'Status: UNRECOGNIZED');
  const numeric = deriveBambuState({ gcode_state: 'RUNNING', nozzle_temper: '210.5', nozzle_target_temper: '215', cooling_fan_speed: '15', mc_percent: '1', mc_remaining_time: '2' });
  assert.equal(numeric.heaters[0].current, 210.5);
  assert.equal(numeric.heaters[0].target, 215);
  assert.equal(numeric.fans[0].speed, 1);
  assert.equal(numeric.progress, 0.01);
  assert.equal(numeric.remaining, 120);
  const malformed = deriveBambuState({ nozzle_temper: true, cooling_fan_speed: [], ams: { ams: [null, { tray: {} }] } });
  assert.deepEqual(malformed.heaters, []);
  assert.deepEqual(malformed.fans, []);
  assert.deepEqual(malformed.filaments, []);
  const { deriveHappyHareFilaments } = await load('moonraker');
  const mmu = deriveHappyHareFilaments({ gate_material: ['PLA', 'ABS', 'PETG'], gate_color: ['ff0000', '#00ff00', 'invalid'], gate_status: [1, 0, 2], ttg_map: [2, 0, 1, -1] });
  assert.deepEqual(mmu.map((slot) => slot.material), ['PETG', 'PLA']);
  assert.equal(mmu[0].color, undefined);
  assert.equal(mmu[1].color, '#ff0000');
  assert.deepEqual(deriveHappyHareFilaments(undefined), []);
  console.log('Bambu AMS/external spool and Happy Hare inventory tests passed.');
} finally { await rm(dir, { recursive: true, force: true }); }
