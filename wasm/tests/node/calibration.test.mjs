import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';
import draco3d from 'draco3d';

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

async function decodeDraco(dracoPath) {
  const drcBuffer = fs.readFileSync(dracoPath);
  const draco = await draco3d.createDecoderModule();
  const decoder = new draco.Decoder();
  const decoderBuffer = new draco.DecoderBuffer();
  decoderBuffer.Init(new Int8Array(drcBuffer), drcBuffer.byteLength);
  
  const geometryType = decoder.GetEncodedGeometryType(decoderBuffer);
  if (geometryType !== draco.TRIANGULAR_MESH) throw new Error('Not mesh');
  
  const mesh = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
  if (!status.ok() || mesh.ptr === 0) throw new Error('Failed');
  
  const numFaces = mesh.num_faces();
  const posAttrib = decoder.GetAttributeByUniqueId(mesh, draco.POSITION);
  const posArray = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, posAttrib, posArray);
  
  const stlBuffer = new ArrayBuffer(84 + numFaces * 50);
  const stlView = new DataView(stlBuffer);
  stlView.setUint32(80, numFaces, true);
  
  let offset = 84;
  const faceIndices = new draco.DracoInt32Array();
  for (let i = 0; i < numFaces; i++) {
    decoder.GetFaceFromMesh(mesh, i, faceIndices);
    const i0 = faceIndices.GetValue(0), i1 = faceIndices.GetValue(1), i2 = faceIndices.GetValue(2);
    offset += 12; // skip normal
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3 + 2), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3 + 2), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3 + 2), true); offset += 4;
    offset += 2;
  }
  
  draco.destroy(faceIndices);
  draco.destroy(posArray);
  draco.destroy(mesh);
  draco.destroy(decoder);
  draco.destroy(decoderBuffer);
  return new Uint8Array(stlBuffer);
}

const range = (start, end, step) => {
  const n = Math.round(Math.abs(end - start) / step);
  return Array.from({ length: n + 1 }, (_, i) => +(start + Math.sign(end - start) * i * step).toFixed(4));
};
const paValues = (gcode) =>
  [...new Set([...gcode.matchAll(/(?:SET_PRESSURE_ADVANCE ADVANCE=|M900 K)([0-9.]+)/g)].map((m) => +m[1]))];
const feedrates = (gcode) => new Set([...gcode.matchAll(/ F([0-9.]+)/g)].map((m) => +m[1]));
const maxZ = (gcode) => Math.max(0, ...[...gcode.matchAll(/^G1 Z([0-9.]+)/gm)].map((m) => +m[1]));

/** Values of `pattern`'s first capture group in order of appearance, with repeats collapsed. */
const series = (gcode, pattern) => {
  const values = [...gcode.matchAll(pattern)].map((m) => +m[1]);
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
};
const assertRamp = (values, start, end, tolerance, what) => {
  assert.ok(values.length > 20, `${what}: expected a ramp, got ${values.length} values`);
  assert.ok(Math.abs(values[0] - start) < 1e-6, `${what} starts at ${start}, got ${values[0]}`);
  assert.ok(Math.abs(values.at(-1) - end) <= tolerance, `${what} ends near ${end}, got ${values.at(-1)}`);
  values.slice(1).forEach((v, i) => assert.ok(v >= values[i], `${what} never goes down (${values[i]} -> ${v})`));
};

describe('Calibration Engine Operations', () => {
  let core;

  // Calibration models are created at the bed origin; place each single-instance
  // model at the interior of the 300 x 300 Voron bed (the loaded cube mesh is not centred on its origin) so it stays inside the bed.
  const sliceOnBed = async (outPath) => {
    const objects = await core.call('listObjects', {});
    if (objects.length === 1 && objects[0].instances.length === 1) {
      const [obj] = objects;
      const [inst] = obj.instances;
      await core.call('setInstanceTransform', { objectId: obj.id, instanceId: inst.id, offset: [100, 100, inst.offset[2]] });
    }
    return core.call('slice', { plateIndex: 0, outPath });
  };

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });
    const resJsonPath = path.join(bundleDir, 'resources.json');
    if (!['resources.json', 'profiles/Voron.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/BBL.json'].every(file => fs.existsSync(path.join(bundleDir, file)))) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary', 'BBL'], {
        stdio: 'inherit'
      });
    }

    const mod = await import(modulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      getResourceBaseUrl: () => `file://${bundleDir}/`,
      bundleVendor: 'Voron',
      bundleFilaments: ['OrcaFilamentLibrary']
    });

    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    const bblJsonPath = path.join(bundleDir, 'profiles', 'BBL.json');
    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(bblJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    console.log("init done");
    try {
        await core.call('loadVendors', {});
        console.log("loadVendors done");
    } catch(e) {
        console.log("loadVendors error: ", e);
    }
    try {
        await core.call('selectPresets', {
          printer: 'Voron 2.4 300 0.4 nozzle',
          process: '0.20mm Standard @Voron',
          filaments: ['Generic PLA @System']
        });
        console.log("selectPresets done");
    } catch(e) {
        console.log("selectPresets error: ", e);
    }


  });

  after(() => {
    if (core) core.dispose();
  });

  const getDrc = async (drcPath, memPath) => {
     const absDrc = path.join(repoRoot, 'resources', drcPath);
     const buf = await decodeDraco(absDrc);
     await core.writeFile(memPath, buf);
  };

  test('PA Tower', async () => {
    await getDrc('calib/pressure_advance/tower_with_seam.drc', '/MEMFS/pa_tower.stl');
    await core.call('setupCalibration', {
        mode: 3, // Calib_PA_Tower
        start: 0,
        end: 0.1,
        step: 0.002,
        extruder_id: 0,
        meshes: {
           "tower_with_seam.drc": "/MEMFS/pa_tower.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out.gcode'));
    
    // Assert M900 or SET_PRESSURE_ADVANCE steps
    assert.deepEqual(paValues(gcode), range(0, 0.1, 0.002));
  });
  
  test('PA Line', async () => {
    await getDrc('calib/pressure_advance/pressure_advance_test.drc', '/MEMFS/pa_line.stl');
    await core.call('setupCalibration', {
        mode: 1, // Calib_PA_Line
        start: 0,
        end: 0.1,
        step: 0.002,
        extruder_id: 0,
        print_numbers: true,
        meshes: {
           "pressure_advance_test.drc": "/MEMFS/pa_line.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_line.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_line.gcode'));
    
    assert.deepEqual(paValues(gcode), range(0, 0.1, 0.002));
  });

  test('PA Pattern', async () => {
    // pattern doesn't need external mesh, it uses handle cube
    await core.call('setupCalibration', {
        mode: 2, // Calib_PA_Pattern
        start: 0,
        end: 0.08,
        step: 0.005,
        extruder_id: 0,
        print_numbers: true,
        accelerations: [500],
        speeds: [100],
        meshes: {}
    });
    const res = await sliceOnBed('/MEMFS/out_pattern.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_pattern.gcode'));
    
    assert.deepEqual(paValues(gcode), range(0, 0.08, 0.005));
  });

  test('Temperature Tower', async () => {
    await getDrc('calib/temperature_tower/temperature_tower.drc', '/MEMFS/temp.stl');
    await core.call('setupCalibration', {
        mode: 6, // Calib_Temp_Tower
        start: 230,
        end: 190,
        step: 5,
        extruder_id: 0,
        nozzle_based_resize: true,
        meshes: {
           "temperature_tower.drc": "/MEMFS/temp.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_temp.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_temp.gcode'));
    
    const temps = [...new Set([...gcode.matchAll(/M104 S([0-9]+)/g)].map((m) => +m[1]))];
    assert.deepEqual(temps, range(230, 190, 5));
    // Desktop cuts the tower to one 10 mm block per temperature.
    assert.ok(Math.abs(maxZ(gcode) - 90) < 0.5, `tower height ${maxZ(gcode)}`);
    // Nothing left over from the PA pattern calibration that ran before.
    assert.ok(paValues(gcode).length <= 1, `stray PA values ${paValues(gcode)}`);
  });

  test('Retraction Tower', async () => {
    await getDrc('calib/retraction/retraction_tower.drc', '/MEMFS/ret.stl');
    await core.call('setupCalibration', {
        mode: 9, // Calib_Retraction_tower
        start: 0,
        end: 2,
        step: 0.1,
        extruder_id: 0,
        meshes: {
           "retraction_tower.drc": "/MEMFS/ret.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_ret.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_ret.gcode'));
    const lengths = new Set([...gcode.matchAll(/^G1 E-([0-9.]+)/gm)].map((m) => +m[1]));
    for (const len of range(0, 2, 0.1).slice(1)) assert.ok(lengths.has(len), `retraction ${len} missing`);
  });
  
  test('Max Volumetric Speed', async () => {
    await getDrc('calib/volumetric_speed/SpeedTestStructure.drc', '/MEMFS/max_vol.stl');
    await core.call('setupCalibration', {
        mode: 7, // Calib_Vol_speed_Tower
        start: 5,
        end: 20,
        step: 0.5,
        extruder_id: 0,
        meshes: {
           "SpeedTestStructure.drc": "/MEMFS/max_vol.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_max_vol.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_max_vol.gcode'));
    // One feed rate per volumetric step: 5..20 mm³/s in 0.5 steps maps to F1620..F3180 in steps of 60 for this structure.
    const f = feedrates(gcode);
    const ramp = range(5, 20, 0.5).map((_, i) => 1620 + 60 * i).filter((v) => v <= 3180);
    for (const v of ramp) assert.ok(f.has(v), `feed rate F${v} missing`);
  });
  
  test('VFA Tower', async () => {
    await getDrc('calib/vfa/vfa.drc', '/MEMFS/vfa.stl');
    await core.call('setupCalibration', {
        mode: 8, // Calib_VFA_Tower
        start: 40,
        end: 200,
        step: 10,
        extruder_id: 0,
        nozzle_based_resize: true,
        vfa_layer_height: 0,
        meshes: {
           "vfa.drc": "/MEMFS/vfa.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_vfa.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_vfa.gcode'));
    const f = feedrates(gcode);
    for (const speed of range(40, 200, 10)) assert.ok(f.has(speed * 60), `VFA speed ${speed} mm/s missing`);
  });


  test('Input Shaping Frequency Test', async () => {
    await getDrc('calib/input_shaping/ringing_tower.drc', '/MEMFS/ringing_tower.stl');
    await core.call('setupCalibration', {
        mode: 10, // Calib_Input_shaping_freq
        start: 0.15, // Damping factor!
        test_model: 0,
        freqStartX: 15,
        freqEndX: 60,
        freqStartY: 15,
        freqEndY: 60,
        meshes: {
           "ringing_tower.drc": "/MEMFS/ringing_tower.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_isfreq.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_isfreq.gcode'));
    
    // The frequency ramps from freqStart to freqEnd along the tower; X and Y move together here.
    assertRamp(series(gcode, /SHAPER_FREQ_X=([0-9.]+) SHAPER_FREQ_Y=[0-9.]+/g), 15, 60, 0.7, 'shaper frequency');
    assert.deepEqual(series(gcode, /SET_INPUT_SHAPER DAMPING_RATIO_X=([0-9.]+)/g), [0.15], 'the damping ratio stays at the requested value');
  });

  test('Input Shaping Damping Test', async () => {
    await getDrc('calib/input_shaping/ringing_tower.drc', '/MEMFS/ringing_tower.stl');
    await core.call('setupCalibration', {
        mode: 11, // Calib_Input_shaping_damp
        start: 0.05, // damp start
        end: 0.15, // damp end
        test_model: 0,
        freqStartX: 30,
        freqStartY: 30,
        shaper_type: "MZV",
        meshes: {
           "ringing_tower.drc": "/MEMFS/ringing_tower.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_isdamp.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_isdamp.gcode'));
    
    assert.ok(gcode.includes('SET_INPUT_SHAPER SHAPER_TYPE=MZV SHAPER_FREQ_X=30.00'), 'sets the shaper type and X frequency');
    assert.ok(gcode.includes('SET_INPUT_SHAPER SHAPER_TYPE=MZV SHAPER_FREQ_Y=30.00'), 'sets the shaper type and Y frequency');
    assertRamp(series(gcode, /SET_INPUT_SHAPER DAMPING_RATIO_X=([0-9.]+) DAMPING_RATIO_Y=[0-9.]+/g), 0.05, 0.15, 0.003, 'damping ratio');
  });

  test('Cornering Test', async () => {
    await getDrc('calib/cornering/SCV-V2.drc', '/MEMFS/scvv2.stl');
    await core.call('setupCalibration', {
        mode: 12, // Calib_Cornering
        start: 1, // jerk start
        end: 10, // jerk end
        test_model: 2, // SCV-V2
        meshes: {
           "SCV-V2.drc": "/MEMFS/scvv2.stl"
        }
    });
    const res = await sliceOnBed('/MEMFS/out_corner.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_corner.gcode'));
    
    // Klipper's square corner velocity ramps from the start value to the end value.
    assertRamp(series(gcode, /SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=([0-9.]+)/g), 1, 10, 0.3, 'square corner velocity');
  });


  test('Reset Calibration Mode', async () => {
    // calib mode is cleared on loadModel
    await core.writeFile('/MEMFS/cube.stl', await decodeDraco(path.join(repoRoot, 'resources/calib/pressure_advance/pressure_advance_test.drc')));
    await core.call('loadModel', { path: '/MEMFS/cube.stl' });
    const res = await sliceOnBed('/MEMFS/out_normal.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_normal.gcode'));
    
    // The PA ramp is gone; like desktop, the calibration's preset edits (PA enabled at 0) remain.
    assert.ok(paValues(gcode).length <= 1, `PA ramp still present: ${paValues(gcode)}`);
  });

  test('openProject leaves calibration mode', async () => {
    await core.call('setupCalibration', {
      mode: 3, start: 0, end: 0.1, step: 0.002, extruder_id: 0,
      meshes: { 'tower_with_seam.drc': '/MEMFS/pa_tower.stl' }
    });
    await core.call('loadModel', { path: '/MEMFS/cube.stl' });
    await core.call('saveProject', { path: '/MEMFS/plain.3mf' });
    await core.call('setupCalibration', {
      mode: 3, start: 0, end: 0.1, step: 0.002, extruder_id: 0,
      meshes: { 'tower_with_seam.drc': '/MEMFS/pa_tower.stl' }
    });
    await core.call('openProject', { path: '/MEMFS/plain.3mf' });
    await sliceOnBed('/MEMFS/out_reopened.gcode');
    const gcode = new TextDecoder().decode(await core.readFile('/MEMFS/out_reopened.gcode'));
    assert.ok(paValues(gcode).length <= 1, `PA ramp still present: ${paValues(gcode)}`);
  });
});
