import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let readings, decode, merge;
before(async () => {
  const telemetry = process.env.TELEMETRY_SOURCE ?? './src/printers/snapmakerTelemetry.ts';
  const bundle = await build({ stdin: { contents: `export * from './src/printers/deviceExtruders'; export * from ${JSON.stringify(telemetry)};`,
    resolveDir: new URL('../../app', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  readings = module.deviceExtruderReadings;
  decode = objects => module.snapmakerPrinterState(module.parseSnapmakerFrame(JSON.stringify({ type: 'snapshot', objects })).objects);
  merge = module.mergeSnapmakerObjects;
});
const heater = (id, toolIndex, kind = 'extruder') => ({ id, label: id, kind, toolIndex, current: 200, target: 210 });
const slot = (slotIndex, presence = 'present') => ({ id: `slot:${slotIndex}`, label: `T${slotIndex}`, slotIndex, material: 'PLA', presence });
const cards = state => readings('snapmaker-cloud', state.heaters, state.filamentSlots);

test('four reversed heaters pair temperatures and grey/blue/black/white PLA by physical index', () => {
  const objects = { print_task_config: { filament_type: Array(4).fill('PLA'), filament_exist: Array(4).fill(true),
    filament_color_rgba: ['808080FF', '0000FFFF', '000000FF', 'FFFFFFFF'] } };
  for (const index of [3, 2, 1, 0]) objects[index ? `extruder${index}` : 'extruder'] = { temperature: 201 + index, target: 211 + index };
  const result = cards(decode(objects));
  assert.deepEqual(result.extruders.map(r => [r.toolIndex, r.heater?.current, r.heater?.target, r.filament?.material, r.filament?.color]),
    [[0,201,211,'PLA','#808080'], [1,202,212,'PLA','#0000FF'], [2,203,213,'PLA','#000000'], [3,204,214,'PLA','#FFFFFF']]);
  assert.deepEqual(result.remainingFilamentSlots, []);
});

test('sparse and remapped tools pair by explicit index with separate bed/chamber/other', () => {
  const state = decode({ extruder1: { extruder_index: 3, temperature: 203, target: 213 }, extruder3: { extruder_index: 1, temperature: 201, target: 211 } });
  state.heaters.push(heater('missing-filament', 7), heater('bed', undefined, 'bed'), heater('chamber', undefined, 'chamber'), heater('other', undefined, 'other'));
  const slots = [slot(3), slot(1), slot(5)];
  const result = readings('snapmaker-cloud', state.heaters, slots);
  assert.deepEqual(result.extruders.map(r => [r.toolIndex, r.heater?.id, r.filament?.slotIndex]),
    [[1,'extruder3',1], [3,'extruder1',3], [5,undefined,5], [7,'missing-filament',undefined]]);
  assert.deepEqual(result.remainingHeaters.map(h => h.id), ['bed','chamber','other']);
  assert.deepEqual(result.remainingFilamentSlots, []);
});

test('invalid and duplicate indices never pair and preserve every heater and readable material', () => {
  for (const invalid of [undefined, -1, 16, 1.5, '0', null, NaN]) {
    const h = heater('invalid', invalid), s = slot(invalid);
    const result = readings('snapmaker-cloud', [h], [s, slot(0)]);
    assert.equal(result.extruders.filter(r => r.heater && r.filament).length, 0);
    assert.equal(result.extruders.find(r => r.heater)?.heater, h);
    assert.deepEqual(result.remainingFilamentSlots, [s]);
  }
  for (const [heaters, slots] of [[[heater('a',0),heater('b',0)],[slot(0)]], [[heater('a',0)],[slot(0),{...slot(0),id:'duplicate'}]]]) {
    const result = readings('snapmaker-cloud', heaters, slots);
    assert.equal(result.extruders.filter(r => r.heater && r.filament).length, 0);
    assert.deepEqual(result.extruders.flatMap(r => r.heater ?? []), heaters);
    assert.deepEqual(result.extruders.flatMap(r => r.filament ?? []), slots);
    assert.deepEqual(result.remainingFilamentSlots, []);
  }
});

test('empty/unknown presence and unavailable versus reported-empty sources survive', () => {
  const slots = [slot(0,'empty'),slot(1,'unknown')];
  assert.deepEqual(readings('snapmaker-cloud', [heater('a',0),heater('b',1)], slots).extruders.map(r => r.filament), slots);
  assert.equal(readings('snapmaker-cloud', [], undefined).remainingFilamentSlots, undefined);
  assert.deepEqual(readings('snapmaker-cloud', [], []).remainingFilamentSlots, []);
});

test('CFS/MMU and other providers preserve all feeder slots without pairing', () => {
  for (const provider of ['creality-cloud','prusaconnect','moonraker','octoprint','prusalink','bambu','bambu-cloud','flashforge']) {
    const slots = [slot(0),slot(1)], heaters = [heater('nozzle',0),heater('bed',undefined,'bed')];
    const result = readings(provider, heaters, slots);
    assert.deepEqual(result.extruders, [{id:'nozzle',toolIndex:0,heater:heaters[0]}]);
    assert.equal(result.remainingFilamentSlots, slots);
    assert.deepEqual(result.remainingHeaters, [heaters[1]]);
    assert.equal(readings(provider, heaters, undefined).remainingFilamentSlots, undefined);
  }
});

test('delta preserves physical remap, explicit null clears it, and cleared material stays unavailable', () => {
  let objects = { extruder: { extruder_index: 3, temperature: 203, target: 213 },
    print_task_config: { filament_type: ['PLA','PLA','PLA','PLA'], filament_exist: [true,true,true,true] } };
  objects = merge(objects, { extruder: { temperature: 204 } });
  assert.equal(cards(decode(objects)).extruders.find(r => r.heater)?.filament?.slotIndex, 3);
  objects = merge(objects, { extruder: { extruder_index: null } });
  assert.equal(cards(decode(objects)).extruders.find(r => r.heater)?.filament, undefined);
  objects = merge(objects, { print_task_config: { filament_type: null, filament_exist: null } });
  assert.equal(cards(decode(objects)).remainingFilamentSlots, undefined);
  assert.deepEqual(cards(decode({})).extruders, []);
});
