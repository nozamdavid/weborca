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
const scratchDir = path.join(bundleDir, 'scratch');

describe('Orca WASM Engine Layer Events Test Suite', () => {
  let core;

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });

    const resJsonPath = path.join(bundleDir, 'resources.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    const bblJsonPath = path.join(bundleDir, 'profiles', 'BBL.json');

    if (
      !fs.existsSync(resJsonPath) ||
      !fs.existsSync(voronJsonPath) ||
      !fs.existsSync(orcaFilJsonPath) ||
      !fs.existsSync(bblJsonPath)
    ) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(
        process.execPath,
        [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary', 'BBL'],
        { stdio: 'inherit' }
      );
    }

    const mod = await import(modulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      threads: 4
    });

    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(bblJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
    await core.call('loadModel', { path: '/models/cube.obj' });
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('getLayerEvents returns empty list for pristine plate', async () => {
    const res = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(res.plateIndex, 0);
    assert.equal(res.count, 0);
    assert.deepEqual(res.events, []);
  });

  test('malformed plateIndex is rejected without defaulting to plate 0', async () => {
    // getLayerEvents rejects non-integer, negative, or wrong type
    await assert.rejects(
      async () => { await core.call('getLayerEvents', { plateIndex: 'invalid' }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('getLayerEvents', { plateIndex: -1 }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('getLayerEvents', { plateIndex: 1.5 }); },
      /Invalid plateIndex/i
    );

    // setLayerEvents rejects invalid plateIndex
    await assert.rejects(
      async () => { await core.call('setLayerEvents', { plateIndex: 'plateZero', events: [] }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('setLayerEvents', { plateIndex: -2, events: [] }); },
      /Invalid plateIndex/i
    );

    // clearLayerEvents rejects invalid plateIndex
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: 'badPlate' }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: -1 }); },
      /Invalid plateIndex/i
    );
  });

  test('setLayerEvents validates entire batch and rejects without partial mutation', async () => {
    // 1. Set one initial valid event
    const initial = await core.call('setLayerEvents', {
      plateIndex: 0,
      events: [
        { printZ: 2.0, type: 'pause', message: 'Initial baseline pause' }
      ]
    });
    assert.equal(initial.count, 1);
    assert.equal(initial.events[0].printZ, 2.0);

    // Helper to check baseline state remains untouched
    const assertBaselineUntouched = async () => {
      const state = await core.call('getLayerEvents', { plateIndex: 0 });
      assert.equal(state.count, 1);
      assert.equal(state.events[0].printZ, 2.0);
      assert.equal(state.events[0].type, 'pause');
      assert.equal(state.events[0].message, 'Initial baseline pause');
    };

    // 2. Attempt batch with one valid and one invalid (negative Z)
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 4.0, type: 'custom', gcode: 'M117 ShouldNotApply' },
            { printZ: -3.0, type: 'pause' }
          ]
        });
      },
      /invalid printZ/i
    );
    await assertBaselineUntouched();

    // 3. Attempt batch with non-numeric printZ string
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 'two-point-zero', type: 'pause' }
          ]
        });
      },
      /missing valid 'printZ'/i
    );
    await assertBaselineUntouched();

    // 4. Attempt batch with unsupported type 'color_change' (concrete native engine limitation)
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 4.0, type: 'color_change' }
          ]
        });
      },
      /Filament\/color change layer events are not supported/i
    );
    await assertBaselineUntouched();

    // 5. Attempt batch with custom type missing/empty gcode
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 5.0, type: 'custom', gcode: '' }
          ]
        });
      },
      /requires non-empty 'gcode'/i
    );
    await assertBaselineUntouched();

    // 6. Attempt batch with invalid extruder type
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 5.0, type: 'pause', extruder: 'extruder1' }
          ]
        });
      },
      /invalid extruder/i
    );
    await assertBaselineUntouched();

    // 7. Attempt batch with out-of-range extruder integer (< 1 or > 255)
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 5.0, type: 'pause', extruder: 0 }
          ]
        });
      },
      /out-of-range extruder/i
    );
    await assertBaselineUntouched();

    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 5.0, type: 'pause', extruder: 300 }
          ]
        });
      },
      /out-of-range extruder/i
    );
    await assertBaselineUntouched();

    // 8. Attempt batch with invalid message type (non-string)
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 5.0, type: 'pause', message: 12345 }
          ]
        });
      },
      /invalid 'message'/i
    );
    await assertBaselineUntouched();

    // 9. Attempt duplicate same-Z events (native engine supports only 1 per layer)
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [
            { printZ: 3.0, type: 'pause', message: 'Pause 1' },
            { printZ: 3.0, type: 'custom', gcode: 'M117 Custom 1' }
          ]
        });
      },
      /Duplicate layer event at printZ/i
    );
    await assertBaselineUntouched();
  });

  test('setLayerEvents configures valid pause and custom gcode sorted ascending by printZ', async () => {
    // Provide events in reverse order: 6.0 before 2.0
    const setRes = await core.call('setLayerEvents', {
      plateIndex: 0,
      events: [
        { printZ: 6.0, type: 'custom', gcode: 'M117 AT_SIX_MM' },
        { printZ: 2.0, type: 'pause', message: 'MAGNET_PAUSE' }
      ]
    });

    assert.equal(setRes.count, 2);
    // Must be automatically sorted ascending by printZ
    assert.equal(setRes.events[0].printZ, 2.0);
    assert.equal(setRes.events[0].type, 'pause');
    assert.equal(setRes.events[0].message, 'MAGNET_PAUSE');

    assert.equal(setRes.events[1].printZ, 6.0);
    assert.equal(setRes.events[1].type, 'custom');
    assert.equal(setRes.events[1].gcode, 'M117 AT_SIX_MM');

    const getRes = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.deepEqual(getRes.events, setRes.events);
  });

  test('clearLayerEvents with supplied nonnumeric or invalid printZ rejects without clearing', async () => {
    // Currently plate 0 has 2 events (2.0 and 6.0)
    const beforeBadClear = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(beforeBadClear.count, 2);

    // Supplying nonnumeric printZ must NOT clear all events; it must reject
    await assert.rejects(
      async () => {
        await core.call('clearLayerEvents', { plateIndex: 0, printZ: 'not-a-number' });
      },
      /Invalid printZ/i
    );

    // State must remain completely unchanged
    const afterBadType = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(afterBadType.count, 2);
    assert.equal(afterBadType.events[0].printZ, 2.0);
    assert.equal(afterBadType.events[1].printZ, 6.0);

    // Negative printZ must also reject without clearing
    await assert.rejects(
      async () => {
        await core.call('clearLayerEvents', { plateIndex: 0, printZ: -2.5 });
      },
      /Invalid printZ/i
    );

    const afterNegative = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(afterNegative.count, 2);
  });

  test('clearLayerEvents removes specific event by printZ or all events', async () => {
    // Clear only printZ = 6.0
    const clearOne = await core.call('clearLayerEvents', { plateIndex: 0, printZ: 6.0 });
    assert.equal(clearOne.clearedCount, 1);
    assert.equal(clearOne.remainingCount, 1);

    const afterClearOne = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(afterClearOne.count, 1);
    assert.equal(afterClearOne.events[0].printZ, 2.0);

    // Clear all on plate 0
    const clearAll = await core.call('clearLayerEvents', { plateIndex: 0 });
    assert.equal(clearAll.clearedCount, 1);
    assert.equal(clearAll.remainingCount, 0);

    const afterClearAll = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(afterClearAll.count, 0);
  });

  test('slicing emits actual pause and custom commands at requested layer', async () => {
    // Configure pause at 2.0mm and custom G-code at 4.0mm
    await core.call('setLayerEvents', {
      plateIndex: 0,
      events: [
        { printZ: 2.0, type: 'pause', message: 'MAGNET_PAUSE' },
        { printZ: 4.0, type: 'custom', gcode: 'M117 CUSTOM_AT_FOUR_MM' }
      ]
    });

    const sliceRes = await core.call('slice', {
      plateIndex: 0,
      outPath: '/out/plate1_events.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'must produce layers');
    assert.ok(sliceRes.gcodeBytes > 0, 'must produce gcode');

    const gcodeBytes = core.readFile('/out/plate1_events.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);
    const lines = gcodeText.split('\n');

    let pauseTagIdx = -1;
    let customTagIdx = -1;

    for (let i = 0; i < lines.length; ++i) {
      if (lines[i].trim() === ';PAUSE_PRINT') pauseTagIdx = i;
      if (lines[i].trim() === ';CUSTOM_GCODE') customTagIdx = i;
    }

    assert.ok(pauseTagIdx > 0, ';PAUSE_PRINT tag must exist in output');
    assert.ok(customTagIdx > 0, ';CUSTOM_GCODE tag must exist in output');
    assert.ok(pauseTagIdx < customTagIdx, 'pause at 2.0mm must appear before custom gcode at 4.0mm');

    // Strengthened check 1: prove actual executable pause command is emitted immediately after ;PAUSE_PRINT tag
    const executablePauseCommand = lines[pauseTagIdx + 1]?.trim();
    assert.equal(executablePauseCommand, 'PAUSE', 'executable machine pause command PAUSE must follow ;PAUSE_PRINT tag');

    // Strengthened check 2: prove pause event is emitted at requested 2.0mm layer
    const pausePrefixLines = lines.slice(Math.max(0, pauseTagIdx - 5), pauseTagIdx);
    const hasLayer2Marker = pausePrefixLines.some((l) => l.trim() === ';2');
    assert.ok(hasLayer2Marker, 'pause event must be emitted at exact layer Z=2.0 (;2)');

    // Strengthened check 3: prove actual custom command is emitted immediately after ;CUSTOM_GCODE tag
    const emittedCustomCommand = lines[customTagIdx + 1]?.trim();
    assert.equal(emittedCustomCommand, 'M117 CUSTOM_AT_FOUR_MM', 'custom G-code command must follow ;CUSTOM_GCODE tag');

    // Strengthened check 4: prove custom event is emitted at requested 4.0mm layer
    const customPrefixLines = lines.slice(Math.max(0, customTagIdx - 5), customTagIdx);
    const hasLayer4Marker = customPrefixLines.some((l) => l.trim() === ';4');
    assert.ok(hasLayer4Marker, 'custom event must be emitted at exact layer Z=4.0 (;4)');
  });

  test('layer events persist across 3MF saveProject and openProject roundtrip', async () => {
    // Current plate 0 has 2 events (2.0 pause, 4.0 custom)
    const beforeSave = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(beforeSave.count, 2);

    const projectPath = '/out/layer_events_roundtrip.3mf';
    await core.call('saveProject', { path: projectPath });
    const savedBytes = core.readFile(projectPath);
    assert.ok(savedBytes.length > 0, 'saved 3MF file must exist and have content in MEMFS');

    // Clear events on plate 0
    await core.call('clearLayerEvents', { plateIndex: 0 });
    const cleared = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(cleared.count, 0);

    // Open saved project
    await core.call('openProject', { path: projectPath });

    const afterLoad = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(afterLoad.count, 2);
    assert.equal(afterLoad.events[0].printZ, 2.0);
    assert.equal(afterLoad.events[0].type, 'pause');
    assert.equal(afterLoad.events[1].printZ, 4.0);
    assert.equal(afterLoad.events[1].type, 'custom');
    assert.equal(afterLoad.events[1].gcode, 'M117 CUSTOM_AT_FOUR_MM');
  });

  test('plate isolation: second plate has no events and slicing second plate emits no layer events from plate 1', async () => {
    // Plate 0 currently has events (2.0 pause, 4.0 custom)
    const plate0Events = await core.call('getLayerEvents', { plateIndex: 0 });
    assert.equal(plate0Events.count, 2);

    // Add Plate 2
    const plates = await core.call('addPlate', { name: 'Plate 2' });
    assert.equal(plates.length, 2);

    // Duplicate instance and move to Plate 2 area (stride_x = 360, place at [510, 150, 10])
    const objects = await core.call('listObjects', {});
    const objId = objects[0].id;
    await core.call('duplicateInstance', {
      objectId: objId,
      instanceId: objects[0].instances[0].id
    });

    const objectsUpdated = await core.call('listObjects', {});
    const inst2Id = objectsUpdated[0].instances[1].id;
    await core.call('setInstanceTransform', {
      objectId: objId,
      instanceId: inst2Id,
      offset: [510.0, 150.0, 10.0]
    });

    // Verify Plate 2 has 0 layer events
    const plate1Events = await core.call('getLayerEvents', { plateIndex: 1 });
    assert.equal(plate1Events.count, 0, 'Plate 2 must have 0 layer events');
    assert.deepEqual(plate1Events.events, []);

    // Slice Plate 2 (plateIndex: 1)
    const sliceRes = await core.call('slice', {
      plateIndex: 1,
      outPath: '/out/plate2_isolated.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'Plate 2 slice must succeed');
    assert.ok(sliceRes.layers > 0, 'Plate 2 slice must produce layers');
    assert.ok(sliceRes.gcodeBytes > 0, 'Plate 2 slice must produce gcode');

    const gcodeBytes = core.readFile('/out/plate2_isolated.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);

    // Plate 2 G-code must NOT contain Plate 1's events!
    assert.ok(
      !gcodeText.includes('M117 CUSTOM_AT_FOUR_MM'),
      'Plate 2 G-code must not contain custom command from Plate 1'
    );
    assert.ok(
      !gcodeText.includes('CUSTOM_GCODE'),
      'Plate 2 G-code must not contain CUSTOM_GCODE tag'
    );
    assert.ok(
      !gcodeText.includes('PAUSE_PRINT') && !gcodeText.includes('PAUSE_PRINTING'),
      'Plate 2 G-code must not contain pause tag'
    );
  });

  test('large integer values and extruder overflow are rejected with existing events unchanged', async () => {
    // Setup baseline event on plate 0
    await core.call('setLayerEvents', {
      plateIndex: 0,
      events: [
        { printZ: 2.0, type: 'pause', message: 'BASELINE_EVENT' }
      ]
    });

    const assertPlate0Untouched = async () => {
      const state = await core.call('getLayerEvents', { plateIndex: 0 });
      assert.equal(state.count, 1);
      assert.equal(state.events[0].printZ, 2.0);
      assert.equal(state.events[0].type, 'pause');
      assert.equal(state.events[0].message, 'BASELINE_EVENT');
    };

    const largeUint = 4294967296; // 2^32
    const largeNeg = -4294967296;

    // 1. getLayerEvents rejects large integer without defaulting or mutating
    await assert.rejects(
      async () => { await core.call('getLayerEvents', { plateIndex: largeUint }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('getLayerEvents', { plateIndex: largeNeg }); },
      /Invalid plateIndex/i
    );
    await assertPlate0Untouched();

    // 2. setLayerEvents rejects large plateIndex without mutating
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: largeUint,
          events: [{ printZ: 3.0, type: 'pause' }]
        });
      },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: largeNeg,
          events: [{ printZ: 3.0, type: 'pause' }]
        });
      },
      /Invalid plateIndex/i
    );
    await assertPlate0Untouched();

    // 3. setLayerEvents rejects extruder overflow and large integer extruder without mutating
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [{ printZ: 3.0, type: 'pause', extruder: 4294967297 }] // 2^32 + 1
        });
      },
      /out-of-range extruder/i
    );
    await assert.rejects(
      async () => {
        await core.call('setLayerEvents', {
          plateIndex: 0,
          events: [{ printZ: 3.0, type: 'pause', extruder: -4294967295 }]
        });
      },
      /out-of-range extruder/i
    );
    await assertPlate0Untouched();

    // 4. clearLayerEvents rejects large plateIndex without mutating
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: largeUint }); },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: largeNeg }); },
      /Invalid plateIndex/i
    );
    await assertPlate0Untouched();

    // 5. clearLayerEvents validates printZ before nonexistent-plate check
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: 999, printZ: -1 }); },
      /Invalid printZ/i
    );
    await assert.rejects(
      async () => { await core.call('clearLayerEvents', { plateIndex: 999, printZ: 'not_a_number' }); },
      /Invalid printZ/i
    );
    await assertPlate0Untouched();

    // 6. slice rejects large plateIndex without altering model
    await assert.rejects(
      async () => {
        await core.call('slice', {
          plateIndex: largeUint,
          outPath: '/out/large_plate.gcode',
          threads: 1
        });
      },
      /Invalid plateIndex/i
    );
    await assert.rejects(
      async () => {
        await core.call('slice', {
          plateIndex: largeNeg,
          outPath: '/out/large_neg_plate.gcode',
          threads: 1
        });
      },
      /Invalid plateIndex/i
    );
    await assertPlate0Untouched();
  });
});
