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

describe('Orca WASM Engine Plate Operations Test Suite', () => {
  let core;

  before(async () => {
    fs.mkdirSync(scratchDir, { recursive: true });

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
      threads: 4
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

    // Write test cube into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('addModel twice gives 2 objects with stable ids', async () => {
    const add1 = await core.call('addModel', { path: '/models/cube.obj' });
    assert.ok(add1 && Array.isArray(add1.objects), 'addModel should return objects array');
    assert.strictEqual(add1.objects.length, 1);
    assert.ok(add1.objects[0].id > 0, 'object id must be positive');

    const list1 = await core.call('listObjects', {});
    assert.strictEqual(list1.length, 1);

    const add2 = await core.call('addModel', { path: '/models/cube.obj' });
    assert.ok(add2 && Array.isArray(add2.objects));
    assert.strictEqual(add2.objects.length, 1);
    assert.notStrictEqual(add1.objects[0].id, add2.objects[0].id, 'stable ids must be distinct');

    const list2 = await core.call('listObjects', {});
    assert.strictEqual(list2.length, 2, 'listObjects must report 2 objects');
    assert.strictEqual(list2[0].id, add1.objects[0].id);
    assert.strictEqual(list2[1].id, add2.objects[0].id);
  });

  test('getMesh of the cube gives 8 or more vertices and 12 triangles with a 20 mm bounding box', async () => {
    const objects = await core.call('listObjects', {});
    assert.ok(objects.length > 0);
    const obj = objects[0];

    const meshInfo = await core.call('getMesh', { objectId: obj.id });
    assert.ok(meshInfo.path, 'getMesh must return a file path');
    assert.ok(meshInfo.vertexCount >= 8, `vertexCount must be >= 8, got ${meshInfo.vertexCount}`);
    assert.strictEqual(meshInfo.triangleCount, 12, `triangleCount must be 12, got ${meshInfo.triangleCount}`);

    const bytes = core.readFile(meshInfo.path);
    assert.ok(bytes && bytes.length > 16, 'binary mesh file must exist');

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    assert.strictEqual(magic, 0x4D455348, 'magic must be 0x4D455348 (MESH)');
    const vCount = view.getUint32(4, true);
    const tCount = view.getUint32(8, true);
    assert.strictEqual(vCount, meshInfo.vertexCount);
    assert.strictEqual(tCount, meshInfo.triangleCount);

    const positions = new Float32Array(bytes.buffer, bytes.byteOffset + 16, vCount * 3);
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const szX = maxX - minX;
    const szY = maxY - minY;
    const szZ = maxZ - minZ;
    assert.ok(Math.abs(szX - 20) < 0.05, `X size must be ~20 mm, got ${szX}`);
    assert.ok(Math.abs(szY - 20) < 0.05, `Y size must be ~20 mm, got ${szY}`);
    assert.ok(Math.abs(szZ - 20) < 0.05, `Z size must be ~20 mm, got ${szZ}`);
  });

  test('setInstanceTransform offset moves the instance and slicing puts G-code bounds there', async () => {
    // Delete second object to isolate single cube slicing
    const objectsBefore = await core.call('listObjects', {});
    if (objectsBefore.length > 1) {
      await core.call('deleteObject', { objectId: objectsBefore[1].id });
    }

    const objects = await core.call('listObjects', {});
    const obj = objects[0];
    const inst = obj.instances[0];

    // Move to X=180, Y=180
    await core.call('setInstanceTransform', {
      objectId: obj.id,
      instanceId: inst.id,
      offset: [180, 180, 0]
    });

    const updated = await core.call('listObjects', {});
    const updatedInst = updated[0].instances[0];
    assert.strictEqual(updatedInst.offset[0], 180);
    assert.strictEqual(updatedInst.offset[1], 180);
    // ensure_on_bed should keep min Z on the bed (offset Z = 10 for centered 20mm cube)
    assert.strictEqual(updatedInst.offset[2], 10);

    const sliceRes = await core.call('slice', {
      outPath: '/out/moved_cube.gcode',
      threads: 4
    });
    assert.ok(sliceRes.layers > 0);

    const gcodeBytes = core.readFile('/out/moved_cube.gcode');
    const gcodeText = new TextDecoder().decode(gcodeBytes);
    const bounds = parseGcodeBounds(gcodeText);

    // Cube has coordinates [-10, 10] in mesh space (centered around origin).
    // With offset X=180, Y=180, the sliced cube extends [170, 190] in X and Y.
    assert.ok(bounds.minX >= 170 && bounds.maxX <= 190.2, `G-code X range must be within [170, 190], got [${bounds.minX}, ${bounds.maxX}]`);
    assert.ok(bounds.minY >= 170 && bounds.maxY <= 190.2, `G-code Y range must be within [170, 190], got [${bounds.minY}, ${bounds.maxY}]`);
  });

  test('rotation 45 degrees about Z changes XY bounds as expected', async () => {
    const objects = await core.call('listObjects', {});
    const obj = objects[0];
    const inst = obj.instances[0];

    // Rotate 45 degrees about Z
    const angleRad = Math.PI / 4;
    await core.call('setInstanceTransform', {
      objectId: obj.id,
      instanceId: inst.id,
      rotation: [0, 0, angleRad]
    });

    const updated = await core.call('listObjects', {});
    const updatedObj = updated[0];

    // For a 20mm cube rotated 45 deg, bounding box size is 20 * sqrt(2) ≈ 28.284 mm
    const expectedDim = 20 * Math.SQRT2;
    assert.ok(
      Math.abs(updatedObj.size[0] - expectedDim) < 0.1,
      `Rotated X size must be ~${expectedDim.toFixed(2)}, got ${updatedObj.size[0]}`
    );
    assert.ok(
      Math.abs(updatedObj.size[1] - expectedDim) < 0.1,
      `Rotated Y size must be ~${expectedDim.toFixed(2)}, got ${updatedObj.size[1]}`
    );
  });

  test('scale 2 gives a 40 mm cube with 200 layers', async () => {
    const objects = await core.call('listObjects', {});
    const obj = objects[0];
    const inst = obj.instances[0];

    // Reset rotation to 0, scale 2
    await core.call('setInstanceTransform', {
      objectId: obj.id,
      instanceId: inst.id,
      rotation: [0, 0, 0],
      scale: [2, 2, 2]
    });

    const updated = await core.call('listObjects', {});
    const updatedObj = updated[0];
    assert.ok(Math.abs(updatedObj.size[0] - 40) < 0.1, `Scaled X must be ~40, got ${updatedObj.size[0]}`);
    assert.ok(Math.abs(updatedObj.size[1] - 40) < 0.1, `Scaled Y must be ~40, got ${updatedObj.size[1]}`);
    assert.ok(Math.abs(updatedObj.size[2] - 40) < 0.1, `Scaled Z must be ~40, got ${updatedObj.size[2]}`);

    const sliceRes = await core.call('slice', {
      outPath: '/out/scaled_cube.gcode',
      threads: 4
    });

    assert.strictEqual(sliceRes.layers, 200, `Scaled cube must have 200 layers, got ${sliceRes.layers}`);
  });

  test('deleteObject removes it', async () => {
    const objects = await core.call('listObjects', {});
    assert.strictEqual(objects.length, 1);
    const obj = objects[0];

    await core.call('deleteObject', { objectId: obj.id });

    const afterDelete = await core.call('listObjects', {});
    assert.strictEqual(afterDelete.length, 0, 'Model must have 0 objects after delete');
  });
});
