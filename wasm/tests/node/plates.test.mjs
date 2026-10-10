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

function parseGcodeBounds(gcodeText) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let layerCount = 0;
  for (const line of gcodeText.split('\n')) {
    if (line.includes(';LAYER_CHANGE')) layerCount++;
    if (!line.startsWith('G1 ')) continue;
    const xMatch = line.match(/X([0-9.]+)/);
    const yMatch = line.match(/Y([0-9.]+)/);
    const zMatch = line.match(/Z([0-9.]+)/);
    if (xMatch) {
      const v = parseFloat(xMatch[1]);
      if (v < minX) minX = v;
      if (v > maxX) maxX = v;
    }
    if (yMatch) {
      const v = parseFloat(yMatch[1]);
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
    if (zMatch) {
      const v = parseFloat(zMatch[1]);
      if (v < minZ) minZ = v;
      if (v > maxZ) maxZ = v;
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, layerCount };
}

describe('Orca WASM Engine Multiple Plates Test Suite', () => {
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
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('listPlates returns initial plate 1 with origin at (0, 0, 0)', async () => {
    const plates = await core.call('listPlates', {});
    assert.ok(Array.isArray(plates), 'listPlates must return an array');
    assert.ok(plates.length >= 1, 'must have at least one plate');
    assert.equal(plates[0].index, 0);
    assert.deepEqual(plates[0].origin, [0, 0, 0]);
  });

  test('addPlate adds a second plate with desktop grid layout origin', async () => {
    const plates = await core.call('addPlate', { name: 'Plate 2' });
    assert.ok(Array.isArray(plates));
    assert.equal(plates.length, 2, 'should have 2 plates now');
    assert.equal(plates[1].index, 1);
    assert.equal(plates[1].name, 'Plate 2');

    // On Voron 300 (width=300, depth=300, stride_x = 300 * 1.2 = 360)
    // 2 plates => cols = 2, row = 0, col = 1 => origin = [360, 0, 0]
    assert.equal(plates[1].origin[0], 360);
    assert.equal(plates[1].origin[1], 0);
    assert.equal(plates[1].origin[2], 0);
  });

  test('moving instance onto plate 2 assigns instance to plate 2 by position', async () => {
    // Load a single cube
    await core.call('loadModel', { path: '/models/cube.obj' });
    const objects = await core.call('listObjects', {});
    const objId = objects[0].id;
    const inst1Id = objects[0].instances[0].id;

    // Duplicate instance
    const dupRes = await core.call('duplicateInstance', { objectId: objId, instanceId: inst1Id });
    const inst2Id = dupRes.instanceId;

    // Move instance 2 to plate 2's bed center (plate 2 origin is [360, 0, 0], bed center is [150, 150])
    // So world offset = [360 + 150, 150, 10]
    await core.call('setInstanceTransform', {
      objectId: objId,
      instanceId: inst2Id,
      offset: [510.0, 150.0, 10.0]
    });

    const plates = await core.call('listPlates', {});
    assert.equal(plates.length, 2);

    // Plate 0 should contain instance 1, Plate 1 should contain instance 2
    const plate0Insts = plates[0].instances.map((i) => i.instanceId);
    const plate1Insts = plates[1].instances.map((i) => i.instanceId);

    assert.ok(plate0Insts.includes(inst1Id), 'Plate 0 must contain instance 1');
    assert.ok(!plate0Insts.includes(inst2Id), 'Plate 0 must not contain instance 2');
    assert.ok(plate1Insts.includes(inst2Id), 'Plate 1 must contain instance 2');
  });

  test('current-plate arrange preserves other plates and locked orientation', async () => {
    const objects = await core.call('listObjects', {});
    const objectId = objects[0].id;
    const [first, second] = objects[0].instances;
    await core.call('setInstanceTransform', {
      objectId, instanceId: first.id, rotation: [0, 0, 0.37]
    });
    const before = (await core.call('listObjects', {}))[0].instances;
    await core.call('arrange', {
      useBed: true, plateIndex: 0, allowRotations: true,
      lockedOrientations: [first.id], spacing: 6
    });
    const after = (await core.call('listObjects', {}))[0].instances;
    assert.deepEqual(after.find(i => i.id === second.id), before.find(i => i.id === second.id),
      'other plate instance must retain every transform');
    const oldRotation = before.find(i => i.id === first.id).rotation;
    after.find(i => i.id === first.id).rotation.forEach((angle, axis) => {
      assert.ok(Math.abs(angle - oldRotation[axis]) < 1e-12, 'locked instance must retain orientation');
    });
    const plates = await core.call('listPlates', {});
    assert.ok(plates[0].instances.some(i => i.instanceId === first.id));
    assert.ok(plates[1].instances.some(i => i.instanceId === second.id));
  });

  test('slice plateIndex 1 slices only plate 2 instances in bed coordinates', async () => {
    const sliceRes = await core.call('slice', {
      outPath: '/out/plate2.gcode',
      plateIndex: 1,
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'plate 2 slice must produce layers');
    assert.ok(sliceRes.gcodeBytes > 0, 'plate 2 slice must produce gcode');

    const gcodeBytes = core.readFile('/out/plate2.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);
    const bounds = parseGcodeBounds(gcodeText);

    // Cube (20mm, corner at 0) was placed at world [510, 150]. With plate origin [360, 0],
    // in G-code (bed coordinates) X is shifted back to ~[150, 170] mm, NOT [510, 530] mm!
    assert.ok(bounds.minX >= 148 && bounds.minX <= 153, `minX should be ~150, was ${bounds.minX}`);
    assert.ok(bounds.maxX >= 167 && bounds.maxX <= 172, `maxX should be ~170, was ${bounds.maxX}`);
    assert.ok(bounds.minY >= 148 && bounds.minY <= 153, `minY should be ~150, was ${bounds.minY}`);
    assert.ok(bounds.maxY >= 167 && bounds.maxY <= 172, `maxY should be ~170, was ${bounds.maxY}`);
  });

  test('setPlateConfig sets per-plate overrides', async () => {
    await core.call('setPlateConfig', {
      plateIndex: 1,
      config: {
        curr_bed_type: 'Textured PEI Plate',
        spiral_mode: '1'
      }
    });

    const plates = await core.call('listPlates', {});
    assert.equal(plates[1].config.curr_bed_type, 'Textured PEI Plate');
    assert.equal(plates[1].config.spiral_mode, '1');
  });

  test('deletePlate removes plate and handles instances', async () => {
    // Delete plate 1
    const plates = await core.call('deletePlate', {
      plateIndex: 1,
      deleteObjects: false
    });

    assert.equal(plates.length, 1, 'should have 1 plate remaining');
    assert.equal(plates[0].index, 0);

    // Cannot delete the only remaining plate
    await assert.rejects(
      async () => {
        await core.call('deletePlate', { plateIndex: 0 });
      },
      /Cannot delete the only plate/
    );
  });

  test('openProject and saveProject round-trip multiple plates', async () => {
    // Add plate 2 again with custom config
    await core.call('addPlate', {
      name: 'Plate 2 BBL',
      config: { curr_bed_type: 'Textured PEI Plate' }
    });

    const objects = await core.call('listObjects', {});
    const objId = objects[0].id;
    const inst1Id = objects[0].instances[0].id;
    const inst2Id = objects[0].instances[1].id;

    // Place instance 1 on Plate 1 (origin [0, 0, 0]), instance 2 on Plate 2 (origin [360, 0, 0])
    await core.call('setInstanceTransform', {
      objectId: objId,
      instanceId: inst2Id,
      offset: [510.0, 150.0, 10.0]
    });

    const platesBefore = await core.call('listPlates', {});
    assert.equal(platesBefore.length, 2);
    assert.equal(platesBefore[0].instances.length, 1, 'Plate 0 must have exactly 1 instance before save');
    assert.equal(platesBefore[1].instances.length, 1, 'Plate 1 must have exactly 1 instance before save');
    assert.equal(platesBefore[0].instances[0].instanceId, inst1Id);
    assert.equal(platesBefore[1].instances[0].instanceId, inst2Id);

    // Save project
    await core.call('saveProject', { path: '/out/multi_plates.3mf' });

    // Open project
    const opened = await core.call('openProject', { path: '/out/multi_plates.3mf' });
    assert.ok(opened.plates, 'openProject must return plates');
    assert.equal(opened.plates.length, 2, 'openProject must restore 2 plates');
    assert.equal(opened.plates[0].index, 0);
    assert.equal(opened.plates[1].index, 1);
    assert.equal(opened.plates[1].name, 'Plate 2 BBL');
    assert.equal(opened.plates[1].config.curr_bed_type, 'Textured PEI Plate');
    assert.equal(opened.plates[0].instances.length, 1, 'openProject must restore exactly 1 instance on Plate 0');
    assert.equal(opened.plates[1].instances.length, 1, 'openProject must restore exactly 1 instance on Plate 1');

    // Confirm spatial assignment survives after openProject
    const platesAfter = await core.call('listPlates', {});
    assert.equal(platesAfter.length, 2);
    assert.equal(platesAfter[0].instances.length, 1);
    assert.equal(platesAfter[1].instances.length, 1);
    assert.equal(platesAfter[0].instances[0].instanceIndex, 0);
    assert.equal(platesAfter[1].instances[0].instanceIndex, 1);
    assert.equal(platesAfter[1].config.curr_bed_type, 'Textured PEI Plate');
  });

  test('default invalid BBL tower coordinates auto-place inside printable region and slice successfully', async () => {
    await core.call('selectPresets', {
      printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
      process: '0.20mm Standard @BBL X1C',
      filaments: ['Bambu PLA Basic @BBL X1C', 'Bambu PLA Matte @BBL X1C']
    });

    const badgePath = path.join(repoRoot, 'resources', 'handy_models', 'OrcaBadge.3mf');
    const badgeBytes = fs.readFileSync(badgePath);
    await core.loadModel('OrcaBadge.3mf', badgeBytes);
    await core.call('arrange', {});

    const sliceRes = await core.call('slice', {
      outPath: '/out/bbl_autotower.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'must produce layers');
    assert.ok(sliceRes.gcodeBytes > 0, 'must produce gcode');

    const gcodeBytes = core.readFile('/out/bbl_autotower.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);

    const matchX = gcodeText.match(/;\s*wipe_tower_x\s*=\s*([0-9.]+)/);
    const matchY = gcodeText.match(/;\s*wipe_tower_y\s*=\s*([0-9.]+)/);
    assert.ok(matchX, 'gcode must include wipe_tower_x');
    assert.ok(matchY, 'gcode must include wipe_tower_y');

    const towerX = parseFloat(matchX[1]);
    const towerY = parseFloat(matchY[1]);

    assert.ok(towerX > 15.0, `tower X (${towerX}) must be adjusted away from invalid preset boundary (15)`);
    assert.ok(towerX < 250.0, `tower X (${towerX}) must lie within printable bed width`);
    assert.ok(towerY > 28.0, `tower Y (${towerY}) must clear exclusion area`);
    assert.ok(towerY < 220.0, `tower Y (${towerY}) must be adjusted away from bed margin boundary (220)`);
  });

  test('genuine two-tool BBL slice with default tower placement extrudes both filaments and wipe tower', async () => {
    await core.call('selectPresets', {
      printer: 'Bambu Lab X1 Carbon 0.4 nozzle',
      process: '0.20mm Standard @BBL X1C',
      filaments: ['Bambu PLA Basic @BBL X1C', 'Bambu PLA Matte @BBL X1C']
    });

    const badgePath = path.join(repoRoot, 'resources', 'handy_models', 'OrcaBadge.3mf');
    const badgeBytes = fs.readFileSync(badgePath);
    await core.loadModel('OrcaBadge.3mf', badgeBytes);

    // OrcaBadge volumes default to extruders 1, 3, 4. Reassign volumes with extruders outside
    // the configured two-filament preset range to extruder 2 so that both extruder 1 and 2
    // are actively used by the model geometry.
    const tree = await core.call('getObjectTree', {});
    for (const obj of tree.objects) {
      for (const vol of obj.volumes) {
        if (vol.extruder !== 1 && vol.extruder !== 2) {
          await core.call('setVolumeExtruder', { objectId: obj.id, volumeId: vol.id, extruder: 2 });
        }
      }
    }

    await core.call('arrange', {});

    const sliceRes = await core.call('slice', {
      outPath: '/out/bbl_two_tool.gcode',
      threads: 4
    });

    assert.ok(sliceRes, 'slice must return a result');
    assert.ok(sliceRes.layers > 0, 'must produce layers');

    const gcodeBytes = core.readFile('/out/bbl_two_tool.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);

    const t0Matches = (gcodeText.match(/^T0/gm) || []).length;
    const t1Matches = (gcodeText.match(/^T1/gm) || []).length;
    assert.ok(t0Matches > 0, 'must emit T0 commands');
    assert.ok(t1Matches > 0, 'must emit T1 commands');

    const hasTower = gcodeText.includes('; Wipe tower') || gcodeText.includes('; WIPE_TOWER') || gcodeText.includes('CP TOOLCHANGE WIPE');
    assert.ok(hasTower, 'must contain wipe tower extrusion moves');
  });
  test('flush matrix changes physical purge extrusion in a two-tool slice', async () => {
    await core.call('setOptions', { options: { flush_volumes_matrix: '0,60,60,0' } });
    const low = await core.call('slice', { outPath: '/out/flush_low.gcode', threads: 4 });
    await core.call('setOptions', { options: { flush_volumes_matrix: '0,600,600,0' } });
    const high = await core.call('slice', { outPath: '/out/flush_high.gcode', threads: 4 });
    assert.ok(high.filamentMm > low.filamentMm, 'larger purge matrix must increase extruded filament');
    const commands = path => new TextDecoder().decode(core.readFile(path)).split('\n').filter(line => /^[GMT]\d/.test(line)).join('\n');
    assert.notEqual(commands('/out/flush_low.gcode'), commands('/out/flush_high.gcode'),
      'machine commands must change, not just the config footer');
  });

  test('wipe tower preview honors per-plate prime tower overrides', async () => {
    await core.call('listPlates', {});
    const enabled = await core.call('getWipeTowerPreview', { plateIndex: 0 });
    assert.equal(enabled.enabled, true);
    assert.ok(enabled.width > 0 && enabled.depth > 0 && enabled.height > 0);
    await core.call('setPlateConfig', { plateIndex: 0, config: { enable_prime_tower: '0' } });
    assert.equal((await core.call('getWipeTowerPreview', { plateIndex: 0 })).enabled, false);
  });

});
