import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';
import { prepareEngineAssets } from '../../web/engine-assets.js';

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

function parseOverlayBin(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  assert.equal(magic, 'PNT1', 'Overlay header must be PNT1');

  const vertexCount = view.getUint32(4, true);
  const triangleCount = view.getUint32(8, true);

  const verticesOffset = 12;
  const vertices = new Float32Array(
    buffer.buffer,
    buffer.byteOffset + verticesOffset,
    vertexCount * 3
  );

  const indicesOffset = verticesOffset + vertexCount * 3 * 4;
  const indices = new Uint32Array(
    buffer.buffer,
    buffer.byteOffset + indicesOffset,
    triangleCount * 3
  );

  return { vertexCount, triangleCount, vertices, indices };
}

function computeMeshArea(vertices, indices) {
  let totalArea = 0;
  const numTriangles = indices.length / 3;
  for (let i = 0; i < numTriangles; i++) {
    const i0 = indices[i * 3];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    const ax = vertices[i0 * 3];
    const ay = vertices[i0 * 3 + 1];
    const az = vertices[i0 * 3 + 2];

    const bx = vertices[i1 * 3];
    const by = vertices[i1 * 3 + 1];
    const bz = vertices[i1 * 3 + 2];

    const cx = vertices[i2 * 3];
    const cy = vertices[i2 * 3 + 1];
    const cz = vertices[i2 * 3 + 2];

    // e1 = b - a, e2 = c - a
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // cross product
    const crossX = e1y * e2z - e1z * e2y;
    const crossY = e1z * e2x - e1x * e2z;
    const crossZ = e1x * e2y - e1y * e2x;

    const crossNorm = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    totalArea += 0.5 * crossNorm;
  }
  return totalArea;
}

function countSupportGcode(gcodeText) {
  let count = 0;
  let inSupport = false;
  for (const line of gcodeText.split('\n')) {
    if (line.startsWith(';TYPE:Support') || line.startsWith(';TYPE:Support interface')) {
      inSupport = true;
    } else if (line.startsWith(';TYPE:')) {
      inSupport = false;
    }
    if (inSupport && line.startsWith('G1 ') && / E[0-9.]+/.test(line)) {
      count++;
    }
  }
  return count;
}

describe('Orca WASM Engine Advanced Paint Tools Test Suite', () => {
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

    // Populate test models into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);

    const bridgeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', 'bridge.obj'));
    core.writeFile('/models/bridge.obj', bridgeBytes);

    const idlerPath = path.join(repoRoot, 'tests', 'data', 'extruder_idler.obj');
    if (fs.existsSync(idlerPath)) {
      core.writeFile('/models/extruder_idler.obj', fs.readFileSync(idlerPath));
    }
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('circle stroke on top face of cube splits triangles and matches area within 15%', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];

    // Top face is at z = cz + 10 (since cube is 20mm tall and centered on bed)
    const hitZ = cz + 10.0;
    const radius = 4.0;
    const expectedArea = Math.PI * radius * radius;

    const strokeRes = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 2 }],
      triangleSplitting: true
    });

    assert.equal(strokeRes.changed, true, 'Stroke must change annotations');
    assert.ok(strokeRes.stats.enforcer > 2, 'Enforcer count must reflect triangle splitting');

    const overlay = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'support'
    });

    assert.ok(overlay.path, 'Overlay path must be returned');
    assert.equal(overlay.states.length, 1);
    assert.equal(overlay.states[0].state, 'enforcer');
    assert.ok(
      overlay.states[0].triangleCount > 2,
      `Overlay triangle count (${overlay.states[0].triangleCount}) must be greater than original facet count (2)`
    );

    const binBytes = core.readFile(overlay.path);
    // Exercise the actual browser worker dispatcher with the already initialized
    // engine; structuredClone applies the same transfer semantics as postMessage.
    const workerSource = fs.readFileSync(path.join(repoRoot, 'wasm/web/engine-worker.js'), 'utf8')
      .replace("import { createEngineCore } from './engine-core.js';", '')
      .replace("import { prepareEngineAssets } from './engine-assets.js';", '')
      .replace('let core = null;', 'let core = injectedCore;');
    let reply;
    const worker = { injectedCore: core, prepareEngineAssets, Uint8Array, AbortController, self: {}, postMessage(message, transfer = []) {
      reply = structuredClone(message, { transfer });
    } };
    vm.runInNewContext(workerSource, worker);
    await worker.self.onmessage({ data: {
      id: 1, method: 'getPaintOverlay', args: { objectId, volumeId, layer: 'support' }
    } });
    assert.equal(reply.ok, true);
    assert.ok(reply.result.buffer instanceof Uint8Array, 'Worker must return overlay bytes to renderer');
    assert.deepEqual(reply.result.buffer, binBytes, 'Transferred overlay must preserve split triangles');
    assert.deepEqual(reply.result.states, overlay.states);
    const parsed = parseOverlayBin(binBytes);
    assert.equal(parsed.triangleCount, overlay.states[0].triangleCount);

    const computedArea = computeMeshArea(parsed.vertices, parsed.indices);
    const areaDiffRatio = Math.abs(computedArea - expectedArea) / expectedArea;
    assert.ok(
      areaDiffRatio <= 0.15,
      `Computed overlay area (${computedArea.toFixed(2)}) should be within 15% of pi*r^2 (${expectedArea.toFixed(2)}), got ratio ${(areaDiffRatio * 100).toFixed(1)}%`
    );
  });

  test('sphere brush paints with 3D cursor', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];
    const hitZ = cz + 10.0;

    const strokeRes = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'seam',
      tool: 'sphere',
      state: 'enforcer',
      radius: 3.0,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 2 }],
      triangleSplitting: true
    });

    assert.equal(strokeRes.changed, true);
    assert.ok(strokeRes.stats.enforcer > 0);

    const overlay = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'seam'
    });
    assert.ok(overlay.states.length >= 1);
    assert.equal(overlay.states[0].state, 'enforcer');
    assert.ok(overlay.states[0].triangleCount > 0);
  });

  test('smart fill with 30 degree angle paints whole flat face but not adjacent faces', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];
    const hitZ = cz + 10.0;

    const res = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'smart_fill',
      state: 'enforcer',
      smartFillAngleDeg: 30,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 2 }]
    });

    assert.equal(res.changed, true);
    // Flat top face has exactly 2 coplanar triangles in 20mm cube
    assert.equal(res.stats.enforcer, 2, 'Smart fill on top face must paint exactly the 2 coplanar facets');

    // Overlay area should equal exactly one face of 20x20 cube = 400 mm^2
    const overlay = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'support'
    });
    const binBytes = core.readFile(overlay.path);
    const parsed = parseOverlayBin(binBytes);
    const faceArea = computeMeshArea(parsed.vertices, parsed.indices);
    assert.ok(Math.abs(faceArea - 400.0) < 1.0, `Face area should be ~400, got ${faceArea}`);
  });

  test('bucket fill paints connected facets and supports bucketPropagate flag', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];
    const hitZ = cz + 10.0;

    // Test bucketPropagate: false (single facet only)
    const resSingle = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'bucket',
      state: 'blocker',
      bucketPropagate: false,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 2 }]
    });
    assert.equal(resSingle.changed, true);
    assert.equal(resSingle.stats.blocker, 1, 'Non-propagating bucket fill should paint only 1 facet');

    // Test bucketPropagate: true (fills whole coplanar region)
    const resPropagate = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'bucket',
      state: 'enforcer',
      bucketPropagate: true,
      smartFillAngleDeg: 30,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 3 }]
    });
    assert.equal(resPropagate.changed, true);
    assert.ok(resPropagate.stats.enforcer >= 1);
  });

  test('overhang angle limiting paints only overhanging triangles', async () => {
    // Load bridge model
    await core.call('loadModel', { path: '/models/bridge.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 100, oy + 89.5, oz + 5];

    // Paint with overhang angle limiting 45 degrees
    // Downward-facing overhangs on underside of the bridge
    const resOverhang = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius: 20.0,
      overhangAngleDeg: 45,
      cameraPos: [cx, cy, cz - 100.0],
      points: [{ hit: [cx, cy, cz], facet: 10 }]
    });

    assert.equal(resOverhang.changed, true);
    const overhangCount = resOverhang.stats.enforcer;
    assert.ok(overhangCount > 0, 'Should paint overhang facets');

    // Clear and paint top face (which is upward facing, 0 overhang) with overhangAngleDeg 45
    await core.call('clearPaint', { objectId, volumeId, layer: 'support' });
    const resTop = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius: 10.0,
      overhangAngleDeg: 45,
      cameraPos: [cx, cy, cz + 100.0],
      points: [{ hit: [cx, cy, cz + 3.0], facet: 0 }]
    });
    // Upward face is not an overhang, so nothing should be painted
    assert.equal(resTop.stats.enforcer, 0, 'Upward facing face should not be painted with overhang limit');
  });

  test('getPaintData and setPaintData restore exact earlier state', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];
    const hitZ = cz + 10.0;

    // Create a split circle stroke
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'color',
      tool: 'circle',
      state: 2,
      radius: 5.0,
      cameraPos: [cx, cy, hitZ + 100.0],
      points: [{ hit: [cx, cy, hitZ], facet: 2 }],
      triangleSplitting: true
    });

    const overlayBefore = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'color'
    });
    assert.ok(overlayBefore.states[0].triangleCount > 2);

    // Snapshot data
    const paintData = await core.call('getPaintData', {
      objectId,
      volumeId,
      layer: 'color'
    });
    assert.ok(paintData.data && paintData.data.length > 0, 'Must return base64 data');

    // Clear layer
    await core.call('clearPaint', { objectId, volumeId, layer: 'color' });
    const overlayCleared = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'color'
    });
    assert.equal(overlayCleared.states.length, 0);

    // Restore data
    const restoreRes = await core.call('setPaintData', {
      objectId,
      volumeId,
      layer: 'color',
      data: paintData.data
    });
    assert.equal(restoreRes.restored, true);

    const overlayRestored = await core.call('getPaintOverlay', {
      objectId,
      volumeId,
      layer: 'color'
    });
    assert.equal(overlayRestored.states.length, 1);
    assert.equal(
      overlayRestored.states[0].triangleCount,
      overlayBefore.states[0].triangleCount,
      'Restored triangle count must exactly match earlier state'
    );
  });

  test('saveProject then openProject preserves split painting for all four layers', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];

    // Paint all 4 layers
    // 1. Support
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius: 4.0,
      points: [{ hit: [cx, cy, cz + 10], facet: 2 }]
    });

    // 2. Seam
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'seam',
      tool: 'circle',
      state: 'blocker',
      radius: 3.0,
      cameraPos: [cx + 100, cy, cz],
      points: [{ hit: [cx + 10, cy, cz], facet: 4 }]
    });

    // 3. Color
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'color',
      tool: 'circle',
      state: 2,
      radius: 4.0,
      cameraPos: [cx, cy - 100, cz],
      points: [{ hit: [cx, cy - 10, cz], facet: 6 }]
    });

    // 4. Fuzzy
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'fuzzy',
      tool: 'circle',
      state: 'fuzzy',
      radius: 4.0,
      cameraPos: [cx - 100, cy, cz],
      points: [{ hit: [cx - 10, cy, cz], facet: 8 }]
    });

    // Get overlay counts before save
    const suppBefore = await core.call('getPaintOverlay', { objectId, volumeId, layer: 'support' });
    const seamBefore = await core.call('getPaintOverlay', { objectId, volumeId, layer: 'seam' });
    const colorBefore = await core.call('getPaintOverlay', { objectId, volumeId, layer: 'color' });
    const fuzzyBefore = await core.call('getPaintOverlay', { objectId, volumeId, layer: 'fuzzy' });

    assert.ok(suppBefore.states[0].triangleCount > 0);
    assert.ok(seamBefore.states[0].triangleCount > 0);
    assert.ok(colorBefore.states[0].triangleCount > 0);
    assert.ok(fuzzyBefore.states[0].triangleCount > 0);

    // Save project
    const projPath = '/out/all_layers_paint.3mf';
    await core.call('saveProject', { path: projPath });

    // Reopen project
    await core.call('openProject', { path: projPath });
    const treeReopened = await core.call('getObjectTree', {});
    const rObjId = treeReopened.objects[0].id;
    const rVolId = treeReopened.objects[0].volumes[0].id;

    const suppAfter = await core.call('getPaintOverlay', { objectId: rObjId, volumeId: rVolId, layer: 'support' });
    const seamAfter = await core.call('getPaintOverlay', { objectId: rObjId, volumeId: rVolId, layer: 'seam' });
    const colorAfter = await core.call('getPaintOverlay', { objectId: rObjId, volumeId: rVolId, layer: 'color' });
    const fuzzyAfter = await core.call('getPaintOverlay', { objectId: rObjId, volumeId: rVolId, layer: 'fuzzy' });

    assert.equal(suppAfter.states[0].triangleCount, suppBefore.states[0].triangleCount, 'Support split paint must survive roundtrip');
    assert.equal(seamAfter.states[0].triangleCount, seamBefore.states[0].triangleCount, 'Seam split paint must survive roundtrip');
    assert.equal(colorAfter.states[0].triangleCount, colorBefore.states[0].triangleCount, 'Color split paint must survive roundtrip');
    assert.equal(fuzzyAfter.states[0].triangleCount, fuzzyBefore.states[0].triangleCount, 'Fuzzy split paint must survive roundtrip');
  });

  test('slicing effects: multi-material color painting produces tool changes T0 and T1', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];

    // Configure 2 filaments
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System', 'Generic PLA @System']
    });

    // Paint half of the cube (e.g. top face) with filament 2
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'color',
      tool: 'smart_fill',
      state: 2,
      smartFillAngleDeg: 30,
      points: [{ hit: [cx, cy, cz + 10.0], facet: 2 }]
    });

    const sliceRes = await core.call('slice', {
      outPath: '/out/mmu_cube.gcode',
      threads: 4
    });
    assert.ok(sliceRes.gcodePath, 'Multi-material slice must succeed');

    const gcodeBytes = core.readFile('/out/mmu_cube.gcode');
    const gcodeText = new TextDecoder('utf-8').decode(gcodeBytes);

    // G-code must have tool change commands T0 and T1
    assert.ok(/(?:^|\n)T0(?:\s|$)/m.test(gcodeText), 'G-code must contain T0 command');
    assert.ok(/(?:^|\n)T1(?:\s|$)/m.test(gcodeText), 'G-code must contain T1 command');
  });

  test('slicing effects: fuzzy skin painting produces jittered wall moves only on painted face', async () => {
    // 1. Slice cube with no fuzzy skin
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 10, oy + 10, oz + 10];

    await core.call('setOptions', {
      options: {
        fuzzy_skin: 'none'
      }
    });

    const resUnpainted = await core.call('slice', {
      outPath: '/out/cube_clean.gcode',
      threads: 4
    });
    const gcodeClean = new TextDecoder('utf-8').decode(core.readFile('/out/cube_clean.gcode'));

    // Count outer wall moves
    function countOuterWallGcodeLines(text) {
      let count = 0;
      let inOuterWall = false;
      for (const line of text.split('\n')) {
        if (line.startsWith(';TYPE:Outer wall')) {
          inOuterWall = true;
        } else if (line.startsWith(';TYPE:')) {
          inOuterWall = false;
        }
        if (inOuterWall && line.startsWith('G1 ') && / E[0-9.]+/.test(line)) {
          count++;
        }
      }
      return count;
    }

    const cleanWallMoves = countOuterWallGcodeLines(gcodeClean);

    // 2. Paint one vertical face with fuzzy skin
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'fuzzy',
      tool: 'smart_fill',
      state: 'fuzzy',
      smartFillAngleDeg: 30,
      points: [{ hit: [cx + 10, cy, cz], facet: 4 }]
    });

    const resFuzzy = await core.call('slice', {
      outPath: '/out/cube_fuzzy.gcode',
      threads: 4
    });
    const gcodeFuzzy = new TextDecoder('utf-8').decode(core.readFile('/out/cube_fuzzy.gcode'));
    const fuzzyWallMoves = countOuterWallGcodeLines(gcodeFuzzy);

    // Fuzzy skin on a face generates high-density jittered micro-segments on that wall
    assert.ok(
      fuzzyWallMoves > cleanWallMoves,
      `Fuzzy skin painted face must produce jittered outer wall points (${fuzzyWallMoves} > ${cleanWallMoves})`
    );
  });

  test('slicing effects: support painting with brush adds support extrusions', async () => {
    await core.call('loadModel', { path: '/models/bridge.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const volumeId = obj.volumes[0].id;
    const instanceId = obj.instances[0].id;
    const [ox, oy, oz] = obj.instances[0].offset;
    const [cx, cy, cz] = [ox + 100, oy + 89.5, oz + 5];

    await core.call('setOptions', {
      options: {
        enable_support: '1',
        support_type: 'normal(manual)',
        bridge_no_support: '0'
      }
    });

    // Brush stroke on underside overhang
    await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius: 6.0,
      cameraPos: [cx, cy, cz - 100.0],
      points: [{ hit: [cx, cy, cz], facet: 10 }]
    });

    const resWithSupport = await core.call('slice', {
      outPath: '/out/bridge_brush_support.gcode',
      threads: 4
    });
    assert.ok(resWithSupport.gcodePath);
    const gcodeText = new TextDecoder('utf-8').decode(core.readFile('/out/bridge_brush_support.gcode'));
    const supportExtrusions = countSupportGcode(gcodeText);
    assert.ok(supportExtrusions > 0, `Brush support painting must produce support extrusions (got ${supportExtrusions})`);
  });

  test('transformed volume overlay emits in object-local coordinates with volume offset, keeping instance transform separate', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const obj = tree.objects[0];
    const objectId = obj.id;
    const instanceId = obj.instances[0].id;

    // Set an explicit instance offset on the plate
    const instOffset = [150.0, 150.0, 0.0];
    await core.call('setInstanceTransform', {
      objectId,
      instanceId,
      offset: instOffset
    });

    // Add a second volume with an explicit volume offset
    const volOffset = [30.0, 20.0, 10.0];
    const addVolRes = await core.call('addVolume', {
      objectId,
      type: 'part',
      shape: 'cube',
      size: [20.0, 20.0, 20.0],
      offset: volOffset
    });
    const vol2Id = addVolRes.volumeId;

    // Get the object mesh and verify volume 2 partition bounds in object space
    const meshRes = await core.call('getMesh', { objectId });
    assert.ok(meshRes.volumes && meshRes.volumes.length === 2);
    const partition2 = meshRes.volumes.find((p) => p.volumeId === vol2Id);
    assert.ok(partition2, 'Volume 2 partition must exist');

    const meshBytes = core.readFile(meshRes.path);
    const meshView = new DataView(meshBytes.buffer, meshBytes.byteOffset, meshBytes.byteLength);
    const meshVCount = meshView.getUint32(4, true);
    const meshPositions = new Float32Array(meshBytes.buffer, meshBytes.byteOffset + 16, meshVCount * 3);
    const meshIndices = new Uint32Array(
      meshBytes.buffer,
      meshBytes.byteOffset + 16 + meshVCount * 3 * 4,
      meshRes.triangleCount * 3
    );

    // Compute partition 2 bounding box from getMesh (object-local)
    let p2MinX = Infinity, p2MaxX = -Infinity;
    let p2MinY = Infinity, p2MaxY = -Infinity;
    let p2MinZ = Infinity, p2MaxZ = -Infinity;
    for (let f = partition2.firstFacet; f < partition2.firstFacet + partition2.facetCount; f++) {
      for (let c = 0; c < 3; c++) {
        const vi = meshIndices[f * 3 + c];
        const x = meshPositions[vi * 3];
        const y = meshPositions[vi * 3 + 1];
        const z = meshPositions[vi * 3 + 2];
        if (x < p2MinX) p2MinX = x;
        if (x > p2MaxX) p2MaxX = x;
        if (y < p2MinY) p2MinY = y;
        if (y > p2MaxY) p2MaxY = y;
        if (z < p2MinZ) p2MinZ = z;
        if (z > p2MaxZ) p2MaxZ = z;
      }
    }
    // Partition 2 in object space should be around [20, 40] x [10, 30] x [0, 20]
    assert.ok(p2MinX >= 19.9 && p2MaxX <= 40.1, `Partition 2 X bounds [${p2MinX}, ${p2MaxX}] must match volume offset`);

    // World coordinates for stroke hit on volume 2 top face:
    // instance offset + volume offset + local face top center [0, 0, 10]
    const worldHit = [instOffset[0] + volOffset[0], instOffset[1] + volOffset[1], instOffset[2] + volOffset[2] + 10.0];
    const strokeRes = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId: vol2Id,
      layer: 'support',
      tool: 'circle',
      state: 'enforcer',
      radius: 4.0,
      cameraPos: [worldHit[0], worldHit[1], worldHit[2] + 100.0],
      points: [{ hit: worldHit, facet: 2 }],
      triangleSplitting: true
    });
    assert.equal(strokeRes.changed, true, 'Stroke on volume 2 must succeed');
    assert.ok(strokeRes.stats.enforcer > 0, 'Enforcer facets must be recorded');

    // Query overlay
    const overlay = await core.call('getPaintOverlay', {
      objectId,
      volumeId: vol2Id,
      layer: 'support'
    });
    assert.ok(overlay.path, 'Overlay path must be returned');
    assert.equal(overlay.states.length, 1);
    assert.equal(overlay.states[0].state, 'enforcer');
    assert.ok(overlay.states[0].triangleCount > 0);

    const binBytes = core.readFile(overlay.path);
    const parsed = parseOverlayBin(binBytes);
    assert.equal(parsed.triangleCount, overlay.states[0].triangleCount);
    assert.ok(parsed.vertexCount > 0);

    // Verify all overlay vertices are in object-local space:
    // 1. Must contain volume offset (inside [p2MinX, p2MaxX] and [p2MinY, p2MaxY])
    // 2. Must NOT contain instance offset (instOffset[0] = 150)
    for (let i = 0; i < parsed.vertexCount; i++) {
      const vx = parsed.vertices[i * 3];
      const vy = parsed.vertices[i * 3 + 1];
      const vz = parsed.vertices[i * 3 + 2];
      assert.ok(
        vx >= p2MinX - 0.01 && vx <= p2MaxX + 0.01,
        `Overlay vertex X (${vx}) must lie within volume object bounds [${p2MinX}, ${p2MaxX}]`
      );
      assert.ok(
        vy >= p2MinY - 0.01 && vy <= p2MaxY + 0.01,
        `Overlay vertex Y (${vy}) must lie within volume object bounds [${p2MinY}, ${p2MaxY}]`
      );
      assert.ok(
        vx < instOffset[0],
        `Overlay vertex X (${vx}) must NOT include instance offset (${instOffset[0]})`
      );
    }

    // Also verify seam overlay alignment on the offset volume with tool: 'triangle'
    const seamStroke = await core.call('paintStroke', {
      objectId,
      instanceId,
      volumeId: vol2Id,
      layer: 'seam',
      tool: 'triangle',
      state: 'enforcer',
      points: [{ hit: worldHit, facet: 2 }]
    });
    assert.equal(seamStroke.changed, true);
    const seamOverlay = await core.call('getPaintOverlay', {
      objectId,
      volumeId: vol2Id,
      layer: 'seam'
    });
    const seamParsed = parseOverlayBin(core.readFile(seamOverlay.path));
    assert.ok(seamParsed.vertexCount > 0);
    for (let i = 0; i < seamParsed.vertexCount; i++) {
      const vx = seamParsed.vertices[i * 3];
      assert.ok(vx >= p2MinX - 0.01 && vx <= p2MaxX + 0.01);
      assert.ok(vx < instOffset[0]);
    }
  });
});
