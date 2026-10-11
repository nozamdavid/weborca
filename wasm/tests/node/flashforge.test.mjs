import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDrivers, restoreGlobals, useGateway } from './lib/driverHarness.mjs';
import { sleep, startGateway } from './lib/gatewayHarness.mjs';
import { startMockFlashforge } from './lib/mockPrinters.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');
const { build } = createRequire(path.join(appDir, 'package.json'))('esbuild');

async function loadFlashforge() {
  const outfile = path.join(os.tmpdir(), `orca-flashforge-${process.pid}.mjs`);
  await build({
    entryPoints: [path.join(appDir, 'src/printers/flashforge.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'error'
  });
  return import(pathToFileURL(outfile).href);
}

/**
 * Protocol References:
 * - @ghosttypes/ff-api (v2.1.0):
 *   https://github.com/GhostTypes/ff-5mp-api-ts/blob/v2.1.0/src/models/ff-models.ts
 *   https://github.com/GhostTypes/ff-5mp-api-ts/blob/v2.1.0/src/models/MachineInfo.ts
 * - Parallel-7/FlashForgeWebUI:
 *   https://github.com/Parallel-7/FlashForgeWebUI
 * - SoftFever/OrcaSlicer:
 *   src/slic3r/Utils/Flashforge.cpp
 *   src/slic3r/Utils/Flashforge.hpp
 */

test('Flashforge authenticates, reports loaded slots and honors read-only upload restrictions', async () => {
  const { createPrinterApi } = await loadDrivers();
  const mock = await startMockFlashforge();
  const gateway = await startGateway({ proxy: 'private' });
  const readOnly = await startGateway({ proxy: 'private', readOnly: true });
  const printer = {
    id: 'ff',
    name: 'Mock',
    host_type: 'flashforge',
    print_host: `127.0.0.1:${mock.port}`,
    serial: 'FF123',
    printhost_apikey: 'CODE',
    use_gateway: false
  };

  try {
    useGateway(gateway);
    const api = createPrinterApi(printer);
    assert.match(await api.test(), /connected/);
    await assert.rejects(
      createPrinterApi({ ...printer, printhost_apikey: 'WRONG' }).test(),
      /Invalid credentials/
    );

    const state = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error('No Flashforge state received')); }, 5000);
      const stop = api.connect((s) => { clearTimeout(timer); stop(); resolve(s); }, reject);
    });

    assert.equal(state.state, 'ready');
    assert.deepEqual(state.filaments, [{ id: '1', label: 'Slot 1', material: 'PLA', color: '#FF0000' }]);

    const gcode = new TextEncoder().encode('G28\nG1 X10\n');
    await api.upload({ filename: 'mock.gcode', gcode, print: false });
    assert.equal(mock.uploads.length, 1);
    assert.equal(mock.uploads[0].printNow, false);
    assert.deepEqual([...mock.uploads[0].content], [...gcode]);

    useGateway(readOnly);
    assert.match(await api.test(), /connected/);
    await assert.rejects(api.upload({ filename: 'blocked.gcode', gcode, print: false }), /read.only|403/i);
    assert.equal(mock.uploads.length, 1);
  } finally {
    restoreGlobals();
    await Promise.all([mock.close(), gateway.close(), readOnly.close()]);
  }
});

test('Flashforge parseNumber rejects booleans, arrays, objects, and empty/whitespace strings', async () => {
  const { parseNumber } = await loadFlashforge();

  assert.equal(parseNumber(true), undefined);
  assert.equal(parseNumber(false), undefined);
  assert.equal(parseNumber([]), undefined);
  assert.equal(parseNumber([1]), undefined);
  assert.equal(parseNumber({}), undefined);
  assert.equal(parseNumber(null), undefined);
  assert.equal(parseNumber(undefined), undefined);
  assert.equal(parseNumber(''), undefined);
  assert.equal(parseNumber('   '), undefined);
  assert.equal(parseNumber('abc'), undefined);
  assert.equal(parseNumber(NaN), undefined);
  assert.equal(parseNumber(Infinity), undefined);

  assert.equal(parseNumber(0), 0);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber(100), 100);
  assert.equal(parseNumber('215.5'), 215.5);
});

test('Flashforge fan speeds convert percent (0..100) and progress uses ratio (0..1) with explicit 0%, 1%, 100% checks', async () => {
  const { fanSpeed, parseFlashforgeDetail } = await loadFlashforge();

  // Fans: 0..100 percentage in Flashforge hardware & protocol
  assert.equal(fanSpeed(0), 0);
  assert.equal(fanSpeed(1), 0.01); // 1% must be 0.01, never 1.0
  assert.equal(fanSpeed(50), 0.5);
  assert.equal(fanSpeed(100), 1.0);
  assert.equal(fanSpeed(null), undefined);
  assert.equal(fanSpeed(''), undefined);
  assert.equal(fanSpeed(true), undefined);

  // Progress: verified 0..1 ratio from MachineInfo.ts lines 211-212 (PrintProgressInt = Math.floor(printProgress * 100))
  assert.equal(parseFlashforgeDetail({ printProgress: 0 }).progress, 0);
  assert.equal(parseFlashforgeDetail({ printProgress: 0.01 }).progress, 0.01); // 1%
  assert.equal(parseFlashforgeDetail({ printProgress: 0.5 }).progress, 0.5);   // 50%
  assert.equal(parseFlashforgeDetail({ printProgress: 1.0 }).progress, 1.0);   // 100%
  assert.equal(parseFlashforgeDetail({ printProgress: null }).progress, undefined);
  assert.equal(parseFlashforgeDetail({ printProgress: '' }).progress, undefined);
  assert.equal(parseFlashforgeDetail({ printProgress: true }).progress, undefined);
});

test('Flashforge status mapping conservatively reflects documented machine states and guards primitive/array detail', async () => {
  const { parseFlashforgeDetail } = await loadFlashforge();

  // Guard against primitives, arrays, nulls
  assert.equal(parseFlashforgeDetail(null).state, 'unknown');
  assert.equal(parseFlashforgeDetail([]).state, 'unknown');
  assert.equal(parseFlashforgeDetail('primitive').state, 'unknown');
  assert.equal(parseFlashforgeDetail(123).state, 'unknown');
  assert.equal(parseFlashforgeDetail({ detail: null }).state, 'unknown');
  assert.equal(parseFlashforgeDetail({ detail: [] }).state, 'unknown');
  assert.equal(parseFlashforgeDetail({ detail: 'not-an-object' }).state, 'unknown');

  // Active printing & prep states
  assert.equal(parseFlashforgeDetail({ status: 'printing' }).state, 'printing');
  assert.equal(parseFlashforgeDetail({ status: 'heating' }).state, 'printing');
  assert.equal(parseFlashforgeDetail({ status: 'calibrate_doing' }).state, 'unknown');
  assert.equal(parseFlashforgeDetail({ status: 'calibrate_doing' }).message, 'Status: calibrate_doing');

  // Documented non-printing states: 'downloading' and 'busy' (ff-api MachineInfo.ts lines 303-307)
  // are NOT printing and NOT idle ready; they map to 'unknown' with raw status message.
  const busy = parseFlashforgeDetail({ status: 'busy' });
  assert.equal(busy.state, 'unknown');
  assert.equal(busy.message, 'Status: busy');

  const dl = parseFlashforgeDetail({ status: 'downloading' });
  assert.equal(dl.state, 'unknown');
  assert.equal(dl.message, 'Status: downloading');

  // Idle / completed states
  assert.equal(parseFlashforgeDetail({ status: 'ready' }).state, 'ready');
  assert.equal(parseFlashforgeDetail({ status: 'cancel' }).state, 'ready');
  assert.equal(parseFlashforgeDetail({ status: 'cancelled' }).state, 'ready');
  assert.equal(parseFlashforgeDetail({ status: 'completed' }).state, 'complete');

  // Paused
  assert.equal(parseFlashforgeDetail({ status: 'pause' }).state, 'paused');
  assert.equal(parseFlashforgeDetail({ status: 'paused' }).state, 'paused');
  assert.equal(parseFlashforgeDetail({ status: 'pausing' }).state, 'paused');

  // Error with and without explicit code
  const err = parseFlashforgeDetail({ status: 'error' });
  assert.equal(err.state, 'error');
  assert.equal(err.message, 'Printer reported error status');

  const withCode = parseFlashforgeDetail({ status: 'error', errorCode: 'ERR_MAX_TEMP' });
  assert.equal(withCode.state, 'error');
  assert.equal(withCode.message, 'Error code: ERR_MAX_TEMP');
});

test('Flashforge parses verified AD5X and Adventurer 5M Pro protocol fixtures', async () => {
  const { parseFlashforgeDetail } = await loadFlashforge();

  // Fixture: Real AD5X response with IFS Material Station (pid 38)
  // Sourced from @ghosttypes/ff-api ff-models.ts
  const ad5xFixture = {
    code: 0,
    detail: {
      status: 'printing',
      name: 'AD5X_Workshop',
      model: 'AD5X',
      pid: 38,
      firmwareVersion: '1.1.8',
      macAddr: '98:03:cf:11:22:33',
      ipAddr: '192.168.1.150',
      errorCode: '',
      platTemp: 60.5,
      platTargetTemp: 60.0,
      rightTemp: 215.2,
      rightTargetTemp: 215.0,
      chamberTemp: 32.0,
      chamberTargetTemp: 0,
      coolingFanSpeed: 80,
      chamberFanSpeed: 30,
      externalFanStatus: 'open',
      internalFanStatus: 'close',
      lightStatus: 'open',
      doorStatus: 'close',
      printProgress: 0.42,
      printDuration: 1800,
      estimatedTime: 2400,
      printLayer: 45,
      targetPrintLayer: 120,
      printFileName: 'multicolor_vase.3mf',
      cameraStreamUrl: 'http://192.168.1.150:8080/?action=stream',
      hasMatlStation: true,
      matlStationInfo: {
        slotCnt: 4,
        currentSlot: 2,
        currentLoadSlot: 2,
        stateAction: 0,
        stateStep: 0,
        slotInfos: [
          { slotId: 1, hasFilament: 1, materialName: 'PLA', materialColor: 'FF0000' },
          { slotId: 2, hasFilament: 1, materialName: 'PETG', materialColor: '#00FF00' },
          { slotId: 3, hasFilament: 0, materialName: '', materialColor: '' },
          { slotId: 4, hasFilament: true, materialName: 'ABS', materialColor: '0000FF' }
        ]
      }
    }
  };

  const parsed = parseFlashforgeDetail(ad5xFixture);
  assert.equal(parsed.state, 'printing');
  assert.equal(parsed.file, 'multicolor_vase.3mf');
  assert.equal(parsed.progress, 0.42);
  assert.equal(parsed.elapsed, 1800);
  assert.equal(parsed.remaining, 2400);
  assert.deepEqual(parsed.layer, { current: 45, total: 120 });
  assert.equal(parsed.software, 'Flashforge 1.1.8');
  assert.deepEqual(parsed.webcams, [{ name: 'Camera', url: 'http://192.168.1.150:8080/?action=stream' }]);

  // Heaters
  assert.deepEqual(parsed.heaters, [
    { id: 'bed', label: 'Bed', kind: 'bed', current: 60.5, target: 60 },
    { id: 'extruder', label: 'Nozzle', kind: 'extruder', current: 215.2, target: 215 },
    { id: 'chamber', label: 'Chamber', kind: 'chamber', current: 32, target: 0 }
  ]);

  // Fans
  assert.deepEqual(parsed.fans, [
    { id: 'cooling', label: 'Cooling fan', speed: 0.8 },
    { id: 'chamber', label: 'Chamber fan', speed: 0.3 },
    { id: 'external', label: 'External fan', speed: 1 },
    { id: 'internal', label: 'Internal fan', speed: 0 }
  ]);

  // Loaded filaments
  assert.deepEqual(parsed.filaments, [
    { id: '1', label: 'Slot 1', material: 'PLA', color: '#FF0000' },
    { id: '2', label: 'Slot 2', material: 'PETG', color: '#00FF00' },
    { id: '4', label: 'Slot 4', material: 'ABS', color: '#0000FF' }
  ]);
});

test('Flashforge parses Creator 5 multi-nozzle fixture with per-tool nozzle arrays', async () => {
  const { parseFlashforgeDetail } = await loadFlashforge();

  // Fixture: Creator 5 Pro multi-nozzle (pid 41)
  // Sourced from @ghosttypes/ff-api MachineInfo.ts
  const creator5Fixture = {
    status: 'paused',
    model: 'Creator 5 Pro',
    pid: 41,
    firmwareVersion: '1.9.4',
    platTemp: 100,
    platTargetTemp: 100,
    nozzleTemps: [240, 245],
    nozzleTargetTemps: [240, 245],
    chamberTemp: 55,
    chamberTargetTemp: 60,
    coolingFanSpeed: 100,
    coolingFanLeftSpeed: 100,
    printProgress: 0.75,
    printDuration: 3600,
    estimatedTime: 1200,
    printLayer: 150,
    targetPrintLayer: 200,
    printFileName: 'dual_material.gcode'
  };

  const parsed = parseFlashforgeDetail(creator5Fixture);
  assert.equal(parsed.state, 'paused');
  assert.equal(parsed.progress, 0.75);
  assert.deepEqual(parsed.layer, { current: 150, total: 200 });

  assert.deepEqual(parsed.heaters, [
    { id: 'bed', label: 'Bed', kind: 'bed', current: 100, target: 100 },
    { id: 'extruder_0', label: 'Nozzle 1', kind: 'extruder', current: 240, target: 240 },
    { id: 'extruder_1', label: 'Nozzle 2', kind: 'extruder', current: 245, target: 245 },
    { id: 'chamber', label: 'Chamber', kind: 'chamber', current: 55, target: 60 }
  ]);

  assert.deepEqual(parsed.fans, [
    { id: 'cooling', label: 'Cooling fan', speed: 1.0 },
    { id: 'cooling_left', label: 'Left cooling fan', speed: 1.0 }
  ]);
});

test('Flashforge connect() follows live state updates through gateway when mock updates detail', async () => {
  const { createPrinterApi } = await loadDrivers();
  const mock = await startMockFlashforge();
  const gateway = await startGateway({ proxy: 'private' });
  const printer = {
    id: 'ff-live',
    name: 'Live Mock',
    host_type: 'flashforge',
    print_host: `127.0.0.1:${mock.port}`,
    serial: 'FF123',
    printhost_apikey: 'CODE',
    use_gateway: false
  };

  try {
    useGateway(gateway);
    const api = createPrinterApi(printer);
    const receivedStates = [];

    const stop = api.connect(
      (state) => receivedStates.push(state),
      (err) => { throw err; }
    );

    // Wait for initial state
    for (let waited = 0; waited < 4000 && receivedStates.length === 0; waited += 50) {
      await sleep(50);
    }
    assert.ok(receivedStates.length >= 1, 'Received initial state');
    assert.equal(receivedStates.at(-1).state, 'ready');

    // Simulate print start
    mock.setDetail({
      status: 'printing',
      printFileName: 'ad5m_benchy.gcode',
      printProgress: 0.15,
      printLayer: 5,
      targetPrintLayer: 100,
      printDuration: 60,
      estimatedTime: 540,
      rightTemp: 215,
      rightTargetTemp: 215,
      platTemp: 60,
      platTargetTemp: 60,
      coolingFanSpeed: 100
    });

    // Wait for updated state on poll
    for (let waited = 0; waited < 5000 && receivedStates.at(-1).state !== 'printing'; waited += 50) {
      await sleep(50);
    }

    const updated = receivedStates.at(-1);
    assert.equal(updated.state, 'printing');
    assert.equal(updated.file, 'ad5m_benchy.gcode');
    assert.equal(updated.progress, 0.15);
    assert.deepEqual(updated.layer, { current: 5, total: 100 });
    assert.equal(updated.elapsed, 60);
    assert.equal(updated.remaining, 540);
    assert.equal(updated.heaters.find((h) => h.id === 'extruder')?.current, 215);

    stop();
  } finally {
    restoreGlobals();
    await Promise.all([mock.close(), gateway.close()]);
  }
});
