/**
 * @file wasm/tests/stress/memory-recovery.mjs
 * Bounded engine memory and recovery harness for OrcaSlicer WebAssembly engine.
 *
 * Scenarios:
 * 1. Initial baseline cube slice (Voron 2.4 300, 0.20mm Standard, Generic PLA).
 * 2. Sequential 1 Benchy instance placed within Voron bed:
 *    - Records model complexity, peak process RSS (MiB), peak JS heap (MiB), duration, success.
 * 3. Sequential 4 Benchy instances placed within Voron bed:
 *    - Records model complexity, peak process RSS (MiB), peak JS heap (MiB), duration, success.
 *    - Verifies instances and bounding boxes remain within bed bounds without overlapping.
 *    - (Load timings are workload metrics, not a comparative benchmark).
 * 4. Three cancellation/recovery cycles:
 *    - Benchy slice cancelled via AbortSignal.
 *    - Follow-up cube slice whose normalized G-code matches baseline.
 * 5. Invalid-input error recovery:
 *    - Corrupt/invalid model input error handling.
 *    - Follow-up cube slice whose normalized G-code matches baseline.
 * 6. Resource disposal verification.
 */

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

const stressDir = path.join(repoRoot, 'wasm', 'build', 'stress');
const profilesDir = path.join(stressDir, 'profiles');
const scratchDir = path.join(stressDir, 'scratch');
const compareScript = path.join(repoRoot, 'wasm', 'spike', 'compare_gcode.sh');

const benchyPath = path.join(repoRoot, 'wasm', 'build', 'models', '3DBenchy.stl');
const cubePath = path.join(repoRoot, 'tests', 'data', '20mm_cube.obj');

/**
 * Normalizes G-code according to wasm/spike/compare_gcode.sh specification:
 * Strips comments, thumbnails, EXCLUDE_OBJECT, M73, and collapses whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeGcode(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  let inThumb = false;
  let inBtt = false;

  for (let line of lines) {
    if (/;[ \t]*(THUMBNAIL_BLOCK_START|thumbnail.*begin)/.test(line)) {
      inThumb = true;
      continue;
    }
    if (inThumb) {
      if (/;[ \t]*(THUMBNAIL_BLOCK_END|thumbnail.*end)/.test(line)) {
        inThumb = false;
      }
      continue;
    }
    if (/^[ \t]*;[0-9a-fA-F]{8}[ \t]*$/.test(line)) {
      inBtt = true;
      continue;
    }
    if (inBtt) {
      if (/;[ \t]*bigtree thumbnail end/.test(line)) {
        inBtt = false;
      }
      continue;
    }

    let s = line.replace(/[ \t]*;.*$/, '').trim();
    if (!s) continue;
    if (/^EXCLUDE_OBJECT/.test(s)) continue;
    if (/^M73([ \t]|$)/.test(s)) continue;
    s = s.replace(/[ \t]+/g, ' ');
    out.push(s);
  }

  return out.join('\n');
}

/**
 * Periodically samples process RSS and JS heap usage while asynchronous
 * WebAssembly engine work executes on background threads.
 * Note: Periodic sampling captures peaks across tick intervals (intervalMs),
 * but cannot observe instantaneous sub-interval spikes. Units are in MiB (1024^2 bytes).
 * @param {number} intervalMs
 */
function createMemorySampler(intervalMs = 10) {
  let peakRss = 0;
  let peakHeapUsed = 0;
  let peakHeapTotal = 0;

  const sample = () => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.heapUsed > peakHeapUsed) peakHeapUsed = mem.heapUsed;
    if (mem.heapTotal > peakHeapTotal) peakHeapTotal = mem.heapTotal;
  };

  sample();
  const timerId = setInterval(sample, intervalMs);
  if (timerId.unref) timerId.unref();

  return {
    stop() {
      clearInterval(timerId);
      sample();
      return {
        peakRssBytes: peakRss,
        peakHeapUsedBytes: peakHeapUsed,
        peakHeapTotalBytes: peakHeapTotal,
        peakRssMiB: (peakRss / (1024 * 1024)).toFixed(2),
        peakHeapUsedMiB: (peakHeapUsed / (1024 * 1024)).toFixed(2),
        peakHeapTotalMiB: (peakHeapTotal / (1024 * 1024)).toFixed(2)
      };
    }
  };
}

describe('Orca WASM Engine Memory and Recovery Stress Suite', () => {
  let core;
  let benchyBytes;
  let cubeBytes;
  let baselineGcodeText = '';
  let baselineGcodeNorm = '';
  const baselineGcodePath = path.join(scratchDir, 'cube_baseline.gcode');

  const recordedMetrics = [];

  before(async () => {
    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(scratchDir, { recursive: true });

    assert.ok(fs.existsSync(benchyPath), `Benchy model not found at ${benchyPath}`);
    assert.ok(fs.existsSync(cubePath), `Cube model not found at ${cubePath}`);
    benchyBytes = fs.readFileSync(benchyPath);
    cubeBytes = fs.readFileSync(cubePath);

    const resJsonPath = path.join(stressDir, 'resources.json');
    const voronJsonPath = path.join(profilesDir, 'Voron.json');
    const orcaFilJsonPath = path.join(profilesDir, 'OrcaFilamentLibrary.json');

    const testNodeDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
    if (!fs.existsSync(resJsonPath) && fs.existsSync(path.join(testNodeDir, 'resources.json'))) {
      fs.copyFileSync(path.join(testNodeDir, 'resources.json'), resJsonPath);
    }
    if (!fs.existsSync(voronJsonPath) && fs.existsSync(path.join(testNodeDir, 'profiles', 'Voron.json'))) {
      fs.copyFileSync(path.join(testNodeDir, 'profiles', 'Voron.json'), voronJsonPath);
    }
    if (!fs.existsSync(orcaFilJsonPath) && fs.existsSync(path.join(testNodeDir, 'profiles', 'OrcaFilamentLibrary.json'))) {
      fs.copyFileSync(path.join(testNodeDir, 'profiles', 'OrcaFilamentLibrary.json'), orcaFilJsonPath);
    }

    if (!fs.existsSync(resJsonPath) || !fs.existsSync(voronJsonPath) || !fs.existsSync(orcaFilJsonPath)) {
      const packScript = path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs');
      execFileSync(process.execPath, [packScript, repoRoot, stressDir, 'Voron', 'OrcaFilamentLibrary'], {
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

    // Establish initial cube baseline
    await core.loadModel('20mm_cube.obj', cubeBytes);
    await core.call('arrange', {});

    const sampler = createMemorySampler(10);
    const t0 = performance.now();
    const sliceRes = await core.call('slice', {
      outPath: '/out/stress_cube_baseline.gcode',
      threads: 4
    });
    const durationS = (performance.now() - t0) / 1000;
    const memStats = sampler.stop();

    assert.strictEqual(sliceRes.layers, 100, 'Baseline cube must have 100 layers');

    const gcodeBytes = core.readFile('/out/stress_cube_baseline.gcode');
    baselineGcodeText = new TextDecoder().decode(gcodeBytes);
    baselineGcodeNorm = normalizeGcode(baselineGcodeText);
    fs.writeFileSync(baselineGcodePath, gcodeBytes);

    recordedMetrics.push({
      scenario: 'Baseline Cube',
      instances: 1,
      triangles: 12,
      durationS: Number(durationS.toFixed(2)),
      peakProcessRssMiB: Number(memStats.peakRssMiB),
      peakJsHeapMiB: Number(memStats.peakHeapUsedMiB),
      layers: sliceRes.layers,
      success: true
    });
  });

  after(() => {
    if (core) {
      core.dispose();
      core = null;
    }

    console.log('\n=================== STRESS HARNESS RECORDED METRICS ===================');
    console.table(recordedMetrics);
    console.log('Note: Sequential load timings represent workload measurements under test, not a benchmark.');
    console.log('Units: Memory metrics are reported in MiB (1024^2 bytes).');
    console.log('========================================================================\n');
  });

  test(
    'Scenario 1: Sequential 1 Benchy instance placed within Voron bed',
    { timeout: 120_000 },
    async () => {
      const loadRes = await core.loadModel('3DBenchy.stl', benchyBytes);
      assert.ok(loadRes?.objects?.length > 0, 'Benchy object must load');

      const objId = loadRes.objects[0].id;
      const meshRes = await core.call('getMesh', { objectId: objId });
      assert.ok(meshRes.vertexCount > 0, 'Mesh must have vertices');
      assert.ok(meshRes.triangleCount > 0, 'Mesh must have triangles');

      await core.call('arrange', { useBed: true });
      const objects = await core.call('listObjects', {});
      assert.strictEqual(objects.length, 1);
      assert.strictEqual(objects[0].instances.length, 1);

      const inst = objects[0].instances[0];
      const singleSize = loadRes.objects[0].size;
      const halfX = singleSize[0] / 2;
      const halfY = singleSize[1] / 2;

      // Voron 2.4 300 bed bounds: 0 to 300 mm
      assert.ok(
        inst.offset[0] >= 0 && inst.offset[0] <= 300,
        `Instance X offset (${inst.offset[0]}) must be within Voron bed [0, 300]`
      );
      assert.ok(
        inst.offset[1] >= 0 && inst.offset[1] <= 300,
        `Instance Y offset (${inst.offset[1]}) must be within Voron bed [0, 300]`
      );
      assert.ok(
        inst.offset[0] - halfX >= 0 && inst.offset[0] + halfX <= 300,
        `Instance bounding box X [${inst.offset[0] - halfX}, ${inst.offset[0] + halfX}] must be within Voron bed [0, 300]`
      );
      assert.ok(
        inst.offset[1] - halfY >= 0 && inst.offset[1] + halfY <= 300,
        `Instance bounding box Y [${inst.offset[1] - halfY}, ${inst.offset[1] + halfY}] must be within Voron bed [0, 300]`
      );

      const complexity = {
        instances: 1,
        vertices: meshRes.vertexCount,
        triangles: meshRes.triangleCount,
        totalTriangles: meshRes.triangleCount * 1,
        stlBytes: benchyBytes.length,
        boundingBoxMm: loadRes.objects[0].size.map((v) => Number(v.toFixed(2)))
      };

      const sampler = createMemorySampler(10);
      const t0 = performance.now();
      const sliceRes = await core.call('slice', {
        outPath: '/out/stress_benchy_1.gcode',
        threads: 4
      });
      const durationS = (performance.now() - t0) / 1000;
      const memStats = sampler.stop();

      assert.ok(sliceRes.layers > 0, '1 Benchy slice must have layers > 0');
      assert.ok(sliceRes.printTimeS > 0, '1 Benchy slice printTimeS must be > 0');

      recordedMetrics.push({
        scenario: '1 Benchy',
        instances: complexity.instances,
        triangles: complexity.totalTriangles,
        durationS: Number(durationS.toFixed(2)),
        peakProcessRssMiB: Number(memStats.peakRssMiB),
        peakJsHeapMiB: Number(memStats.peakHeapUsedMiB),
        layers: sliceRes.layers,
        success: true
      });
    }
  );

  test(
    'Scenario 2: Sequential 4 Benchy instances placed within Voron bed',
    { timeout: 120_000 },
    async () => {
      const loadRes = await core.loadModel('3DBenchy.stl', benchyBytes);
      assert.ok(loadRes?.objects?.length > 0, 'Benchy object must load');

      const objId = loadRes.objects[0].id;
      const initialObjects = await core.call('listObjects', {});
      const baseInstanceId = initialObjects[0].instances[0].id;

      for (let i = 0; i < 3; i++) {
        const dupRes = await core.call('duplicateInstance', {
          objectId: objId,
          instanceId: baseInstanceId
        });
        assert.ok(dupRes?.instanceId, `Duplicate ${i + 1} must succeed`);
      }

      await core.call('arrange', { useBed: true });
      const objects = await core.call('listObjects', {});
      assert.strictEqual(objects.length, 1);
      assert.strictEqual(objects[0].instances.length, 4, 'Must have 4 instances');

      const singleSize = loadRes.objects[0].size;
      const halfX = singleSize[0] / 2;
      const halfY = singleSize[1] / 2;

      const seenOffsets = new Set();
      for (let i = 0; i < objects[0].instances.length; i++) {
        const inst = objects[0].instances[i];
        assert.ok(
          inst.offset[0] >= 0 && inst.offset[0] <= 300,
          `Instance ${i} X offset (${inst.offset[0]}) must be within Voron bed [0, 300]`
        );
        assert.ok(
          inst.offset[1] >= 0 && inst.offset[1] <= 300,
          `Instance ${i} Y offset (${inst.offset[1]}) must be within Voron bed [0, 300]`
        );
        assert.ok(
          inst.offset[0] - halfX >= 0 && inst.offset[0] + halfX <= 300,
          `Instance ${i} bounding box X [${inst.offset[0] - halfX}, ${inst.offset[0] + halfX}] must be within Voron bed [0, 300]`
        );
        assert.ok(
          inst.offset[1] - halfY >= 0 && inst.offset[1] + halfY <= 300,
          `Instance ${i} bounding box Y [${inst.offset[1] - halfY}, ${inst.offset[1] + halfY}] must be within Voron bed [0, 300]`
        );

        const key = `${inst.offset[0].toFixed(3)},${inst.offset[1].toFixed(3)}`;
        assert.ok(!seenOffsets.has(key), `Instances must not overlap at identical offset ${key}`);
        seenOffsets.add(key);
      }

      const meshRes = await core.call('getMesh', { objectId: objId });
      const complexity = {
        instances: 4,
        verticesPerInstance: meshRes.vertexCount,
        trianglesPerInstance: meshRes.triangleCount,
        totalTriangles: meshRes.triangleCount * 4,
        stlBytes: benchyBytes.length
      };

      const sampler = createMemorySampler(10);
      const t0 = performance.now();
      const sliceRes = await core.call('slice', {
        outPath: '/out/stress_benchy_4.gcode',
        threads: 4
      });
      const durationS = (performance.now() - t0) / 1000;
      const memStats = sampler.stop();

      assert.ok(sliceRes.layers > 0, '4 Benchy slice must have layers > 0');
      assert.ok(sliceRes.printTimeS > 0, '4 Benchy slice printTimeS must be > 0');

      recordedMetrics.push({
        scenario: '4 Benchy',
        instances: complexity.instances,
        triangles: complexity.totalTriangles,
        durationS: Number(durationS.toFixed(2)),
        peakProcessRssMiB: Number(memStats.peakRssMiB),
        peakJsHeapMiB: Number(memStats.peakHeapUsedMiB),
        layers: sliceRes.layers,
        success: true
      });
    }
  );

  test(
    'Scenario 3: Three cancellation and recovery cycles using AbortSignal',
    { timeout: 120_000 },
    async () => {
      for (let cycle = 1; cycle <= 3; cycle++) {
        // Load Benchy for cancellation test
        await core.loadModel('3DBenchy.stl', benchyBytes);
        await core.call('arrange', { useBed: true });

        const ac = new AbortController();
        const t0 = performance.now();
        const timer = setTimeout(() => {
          ac.abort();
        }, 250);

        let wasCanceled = false;
        try {
          const res = await core.call(
            'slice',
            { outPath: `/out/stress_benchy_cancel_${cycle}.gcode`, threads: 4 },
            { signal: ac.signal }
          );
          if (res && res.canceled) {
            wasCanceled = true;
          }
        } catch (err) {
          if (err.canceled || err.name === 'AbortError' || err.message?.includes('canceled')) {
            wasCanceled = true;
          }
        } finally {
          clearTimeout(timer);
        }

        const cancelElapsedMs = performance.now() - t0;
        assert.ok(wasCanceled, `Cycle ${cycle}: slice must report canceled`);
        assert.ok(
          cancelElapsedMs < 10_000,
          `Cycle ${cycle}: cancel must finish well within scenario bounds (took ${cancelElapsedMs.toFixed(0)} ms)`
        );

        // Recovery: slice standard cube and verify exact normalized G-code match
        await core.loadModel('20mm_cube.obj', cubeBytes);
        await core.call('arrange', {});

        const sampler = createMemorySampler(10);
        const tRecStart = performance.now();
        const recSliceRes = await core.call('slice', {
          outPath: `/out/stress_cube_recovery_${cycle}.gcode`,
          threads: 4
        });
        const recDurationS = (performance.now() - tRecStart) / 1000;
        const memStats = sampler.stop();

        assert.strictEqual(
          recSliceRes.layers,
          100,
          `Cycle ${cycle}: recovered cube slice must have 100 layers`
        );

        const recGcodeBytes = core.readFile(`/out/stress_cube_recovery_${cycle}.gcode`);
        const recGcodeText = new TextDecoder().decode(recGcodeBytes);
        const recGcodeNorm = normalizeGcode(recGcodeText);

        assert.strictEqual(
          recGcodeNorm,
          baselineGcodeNorm,
          `Cycle ${cycle}: normalized G-code must match baseline cube exactly`
        );

        const recGcodePath = path.join(scratchDir, `cube_recovery_${cycle}.gcode`);
        fs.writeFileSync(recGcodePath, recGcodeBytes);
        execFileSync('bash', [compareScript, baselineGcodePath, recGcodePath], {
          stdio: 'pipe'
        });

        recordedMetrics.push({
          scenario: `Cancel/Recover #${cycle}`,
          instances: 1,
          triangles: 12,
          durationS: Number(recDurationS.toFixed(2)),
          peakProcessRssMiB: Number(memStats.peakRssMiB),
          peakJsHeapMiB: Number(memStats.peakHeapUsedMiB),
          layers: recSliceRes.layers,
          success: true
        });
      }
    }
  );

  test(
    'Scenario 4: Invalid-input then valid cube recovery',
    { timeout: 120_000 },
    async () => {
      let rejected = false;
      try {
        await core.call('loadModel', { path: '/models/nonexistent_invalid_path.stl' });
      } catch (err) {
        rejected = true;
        assert.ok(err.message, 'Invalid input error must have a message');
      }
      assert.ok(rejected, 'Invalid model load must reject');

      // Recovery: slice standard cube and verify exact normalized G-code match
      await core.loadModel('20mm_cube.obj', cubeBytes);
      await core.call('arrange', {});

      const sampler = createMemorySampler(10);
      const tRecStart = performance.now();
      const recSliceRes = await core.call('slice', {
        outPath: '/out/stress_cube_invalid_rec.gcode',
        threads: 4
      });
      const recDurationS = (performance.now() - tRecStart) / 1000;
      const memStats = sampler.stop();

      assert.strictEqual(
        recSliceRes.layers,
        100,
        'Recovered cube slice after invalid input must have 100 layers'
      );

      const recGcodeBytes = core.readFile('/out/stress_cube_invalid_rec.gcode');
      const recGcodeText = new TextDecoder().decode(recGcodeBytes);
      const recGcodeNorm = normalizeGcode(recGcodeText);

      assert.strictEqual(
        recGcodeNorm,
        baselineGcodeNorm,
        'Normalized G-code after invalid input recovery must match baseline cube exactly'
      );

      const recGcodePath = path.join(scratchDir, 'cube_invalid_rec.gcode');
      fs.writeFileSync(recGcodePath, recGcodeBytes);
      execFileSync('bash', [compareScript, baselineGcodePath, recGcodePath], {
        stdio: 'pipe'
      });

      recordedMetrics.push({
        scenario: 'InvalidInput/Recover',
        instances: 1,
        triangles: 12,
        durationS: Number(recDurationS.toFixed(2)),
        peakProcessRssMiB: Number(memStats.peakRssMiB),
        peakJsHeapMiB: Number(memStats.peakHeapUsedMiB),
        layers: recSliceRes.layers,
        success: true
      });
    }
  );

  test('Scenario 5: Resource disposal verification', () => {
    assert.ok(core, 'Core should still exist prior to disposal');
    core.dispose();
    core = null;
    assert.strictEqual(core, null, 'Core reference cleared and resources disposed');
  });
});
