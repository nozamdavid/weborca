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
  : path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs');
  
if (!fs.existsSync(modulePath)) {
  console.log('Using fallback module path');
}

const fallbackModulePath = path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs');
const finalModulePath = fs.existsSync(modulePath) ? modulePath : fallbackModulePath;

const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
const scratchDir = path.join(bundleDir, 'scratch');

describe('Large Project Coverage', () => {
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

    const mod = await import(finalModulePath);
    const moduleFactory = mod.createOrcaEngine || mod.default;

    core = await createEngineCore({
      moduleFactory,
      threads: process.env.WASM_JOBS ? parseInt(process.env.WASM_JOBS, 10) : 4
    });

    await core.addVendorBundle(JSON.parse(fs.readFileSync(resJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await core.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));

    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('High polygon mesh, 50+ copies, multiple plates, 3MF round trip', async () => {
    const startTime = Date.now();
    
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    const meshPath = path.join(repoRoot, 'tests', 'data', 'frog_legs.obj');
    const meshBytes = fs.readFileSync(meshPath);
    
    console.log(`[LargeProject] Loading high-poly mesh (size: ${(meshBytes.length/1024/1024).toFixed(2)} MB)...`);
    await core.loadModel('frog_legs.obj', meshBytes);

    const objects = await core.call('listObjects', {});
    assert.equal(objects.length, 1);
    const objId = objects[0].id;

    console.log(`[LargeProject] Creating 55 copies...`);
    for (let i = 0; i < 55; i++) {
      await core.call('duplicateInstance', { objectId: objId, instanceId: objects[0].instances[0].id });
    }
    
    const objAfter = await core.call('listObjects', {});
    const instanceCount = objAfter[0].instances.length;
    assert.equal(instanceCount, 56); // 1 original + 55 copies
    
    console.log(`[LargeProject] Placing ${instanceCount} instances on 3 plates inside their beds...`);
    await core.call('addPlate', { name: 'Plate 2' });
    await core.call('addPlate', { name: 'Plate 3' });
    // Voron 300 bed: plate stride is 360 mm; 3 plates use 2 columns (plate 2 is below plate 0).
    const plateOrigins = [[0, 0], [360, 0], [0, -360]];
    const perPlate = 25; // 5 x 5 grid at 55 mm pitch for the ~52 x 50 mm mesh
    for (let i = 0; i < instanceCount; i++) {
      const plate = Math.floor(i / perPlate);
      const cell = i % perPlate;
      await core.call('setInstanceTransform', {
        objectId: objId,
        instanceId: objAfter[0].instances[i].id,
        offset: [plateOrigins[plate][0] + 40 + 55 * (cell % 5), plateOrigins[plate][1] + 40 + 55 * Math.floor(cell / 5), objAfter[0].instances[i].offset[2]]
      });
    }

    const plates = await core.call('listPlates', {});
    assert.equal(plates.length, 3);
    const preSavePlates = await core.call('listPlates', {});
    
    console.log(`[LargeProject] Saving to 3MF...`);
    await core.call('saveProject', { path: '/out/large_project.3mf' });
    const savedBytes = core.readFile('/out/large_project.3mf');
    console.log(`[LargeProject] Saved 3MF size: ${(savedBytes.length/1024/1024).toFixed(2)} MB`);
    
    // Clear project
    // Usually openProject overwrites.
    
    console.log(`[LargeProject] Opening saved 3MF...`);
    const openRes = await core.call('openProject', { path: '/out/large_project.3mf' });
    
    const postOpenPlates = await core.call('listPlates', {});
    const postOpenObjects = await core.call('listObjects', {});
    
    assert.equal(postOpenObjects[0].instances.length, instanceCount, "Instance counts must match after round trip");
    assert.equal(postOpenPlates.length, preSavePlates.length, "Plate counts must match after round trip");
    
    console.log(`[LargeProject] Slicing...`);
    const sliceRes = await core.call('slice', { outPath: '/out/large.gcode', threads: 3 });
    
    const gcodeBytes = core.readFile('/out/large.gcode');
    console.log(`[LargeProject] Sliced! Layers: ${sliceRes.layers}, G-code size: ${(gcodeBytes.length/1024/1024).toFixed(2)} MB`);
    
    assert.ok(sliceRes.layers > 0, 'Slice must produce layers');
    assert.ok(gcodeBytes.length > 0, 'G-code must be non-empty');
    
    const wallTimeMs = Date.now() - startTime;
    const memUsage = process.memoryUsage();
    
    let heapSizeMsg = '';
    try {
      const stats = await core.call('getMemoryStats', {});
      if (stats && stats.heapSize) {
        heapSizeMsg = `Wasm Heap: ${(stats.heapSize/1024/1024).toFixed(2)} MB`;
      }
    } catch(e) {}
    
    console.log(`\n=== Large Project Stats ===`);
    console.log(`Wall time: ${(wallTimeMs / 1000).toFixed(2)} s`);
    console.log(`Node RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Node Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    if (heapSizeMsg) console.log(heapSizeMsg);
    console.log(`===========================\n`);
  });
});
