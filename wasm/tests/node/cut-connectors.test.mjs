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

describe('Orca WASM Cut with Connectors Test Suite', () => {
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

    // Write 20mm test cube into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('two upper plugs retain distinct identities, point downward and have socket clearance', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const treeBefore = await core.call('getObjectTree', {});
    assert.equal(treeBefore.objects.length, 1);
    const origId = treeBefore.objects[0].id;

    // Cut at z = 10.0 mm with 2 plug connectors
    const cutRes = await core.call('cutObjectWithConnectors', {
      objectId: origId,
      z: 10.0,
      coordinateSystem: 'world',
      keepUpper: true,
      keepLower: true,
      connectors: [
        {
          pos: [5.0, 10.0, 10.0],
          attrs: {
            type: 'plug',
            style: 'prism',
            shape: 'circle',
            size: 3.0,
            depthRatio: 4.0,
            tolerance: 0.1,
            targetHalf: 'upper'
          }
        },
        {
          pos: [15.0, 10.0, 10.0],
          attrs: {
            type: 'plug',
            style: 'prism',
            shape: 'circle',
            size: 3.0,
            depthRatio: 4.0,
            tolerance: 0.1,
            targetHalf: 'upper'
          }
        }
      ]
    });

    assert.equal(cutRes.success, true, 'cutObjectWithConnectors should succeed');
    assert.equal(cutRes.connectorCount, 2, 'connectorCount must be 2');
    assert.ok(Array.isArray(cutRes.createdObjects), 'createdObjects must be an array');
    assert.equal(cutRes.createdObjects.length, 2, 'cutting at midpoint must produce exactly 2 objects');

    const upper = cutRes.createdObjects.find((o) => o.part === 'upper');
    const lower = cutRes.createdObjects.find((o) => o.part === 'lower');
    assert.ok(upper, 'upper half must exist');
    assert.ok(lower, 'lower half must exist');

    // Both halves must be closed watertight meshes (0 open edges)
    assert.equal(upper.openEdges, 0, 'upper half must have 0 open edges (watertight closed)');
    assert.equal(lower.openEdges, 0, 'lower half must have 0 open edges (watertight closed)');

    // These are signed component volumes, not a boolean union or fit proof.
    assert.equal(upper.volumeIsBooleanResult, false);
    assert.equal(lower.volumeIsBooleanResult, false);
    assert.equal(cutRes.fitValidated, false);
    for (let i = 1; i <= 2; ++i) {
      const peg = upper.volumes.find(v => v.name === `Connector-${i}`);
      const socket = lower.volumes.find(v => v.name === `Connector-${i}`);
      assert.ok(peg && socket, "each connector has a matching peg and socket");
      assert.equal(peg.type, "normal_part");
      assert.equal(socket.type, "negative_part");
      assert.ok(peg.volume > 0 && socket.volume < 0);
      assert.ok(Math.abs(peg.scalingFactor[0] - 1.5) < 1e-5);
      assert.ok(Math.abs(socket.scalingFactor[0] - 1.55) < 1e-5);
      // 4 mm peg + 0.1 mm clearance + 0.05 mm overlap through the cut face.
      assert.ok(Math.abs(socket.scalingFactor[2] - 4.15) < 1e-5);
      assert.ok(Math.abs(peg.boundingBox.min[2] - 6) < 1e-4);
      assert.ok(Math.abs(peg.boundingBox.max[2] - 10) < 1e-4);
      assert.ok(socket.boundingBox.min[2] < peg.boundingBox.min[2]);
      assert.ok(Math.abs(socket.boundingBox.max[2] - 10.05) < 1e-4);
    }

    // Verify volumes array detail on both objects
    assert.ok(upper.volumes.length >= 3, 'upper should contain cut part and 2 connector peg volumes');
    assert.ok(lower.volumes.length >= 3, 'lower should contain cut part and 2 connector hole volumes');

    // Verify original object was deleted and replaced
    const treeAfter = await core.call('getObjectTree', {});
    assert.equal(treeAfter.objects.length, 2, 'model tree should have 2 objects');
    assert.ok(!treeAfter.objects.some((o) => o.id === origId), 'original object must be removed');
  });

  test('empty connectors list preserves identical behavior to plain cut', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const treeBefore = await core.call('getObjectTree', {});
    const origId = treeBefore.objects[0].id;

    // Cut with empty connectors list
    const cutRes = await core.call('cutObjectWithConnectors', {
      objectId: origId,
      z: 10.0,
      coordinateSystem: 'world',
      keepUpper: true,
      keepLower: true,
      connectors: []
    });

    assert.equal(cutRes.success, true);
    assert.equal(cutRes.connectorCount, 0, 'connectorCount must be 0 for empty connectors list');
    assert.equal(cutRes.createdObjects.length, 2);

    const upper = cutRes.createdObjects.find((o) => o.part === 'upper');
    const lower = cutRes.createdObjects.find((o) => o.part === 'lower');
    assert.ok(upper && lower);

    assert.equal(upper.openEdges, 0);
    assert.equal(lower.openEdges, 0);

    // Both should match plain cut volume (~4000 mm^3) within tolerance
    assert.ok(Math.abs(upper.volume - 4000.0) < 20.0, `upper volume ${upper.volume} should be ~4000.0`);
    assert.ok(Math.abs(lower.volume - 4000.0) < 20.0, `lower volume ${lower.volume} should be ~4000.0`);
  });

  test('invalid plane preserves original object completely untouched on failure', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const treeBefore = await core.call('getObjectTree', {});
    assert.equal(treeBefore.objects.length, 1);
    const origId = treeBefore.objects[0].id;
    const origName = treeBefore.objects[0].name;

    // Cut plane above object (cube is 0..20, plane at z = 50) with connectors
    const resAbove = await core.call('cutObjectWithConnectors', {
      objectId: origId,
      z: 50.0,
      connectors: [
        {
          pos: [10.0, 10.0, 50.0],
          attrs: { type: 'plug', size: 3.0, depthRatio: 4.0 }
        }
      ]
    });

    assert.equal(resAbove.success, false, 'cut above object should fail');
    assert.ok(resAbove.error.includes('does not intersect'));

    // Verify original object is intact and untouched
    const treeAfter = await core.call('getObjectTree', {});
    assert.equal(treeAfter.objects.length, 1);
    assert.equal(treeAfter.objects[0].id, origId);
    assert.equal(treeAfter.objects[0].name, origName);
    assert.deepEqual(treeAfter, treeBefore);
  });

  test('malformed dimensions, off-plane connectors and unsafe keep modes preserve the tree', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;
    for (const patch of [
      { connectors: [{ pos: [10, 10, 10], radius: -1 }] },
      { connectors: [{ pos: [10, 10, 11], radius: 1 }] },
      { connectors: [{ pos: [10, 10, 10], type: 'unknown' }] },
      { keepAsParts: true },
      { keepLower: false }
    ]) {
      await assert.rejects(core.call('cutObjectWithConnectors', {
        objectId, z: 10, connectors: [{ pos: [10, 10, 10], radius: 1 }], ...patch
      }));
      assert.deepEqual(await core.call('getObjectTree', {}), before);
    }
  });

  test('dowel cut creates a separate positive pin and two negative sockets', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const { objects: [obj] } = await core.call('getObjectTree', {});
    const result = await core.call('cutObjectWithConnectors', {
      objectId: obj.id, z: 10,
      connectors: [{ pos: [10, 10, 10], type: 'dowel', radius: 1.5, height: 4 }]
    });
    assert.equal(result.success, true);
    assert.equal(result.createdObjects.length, 3);
    const dowel = result.createdObjects.find(o => o.part === 'dowel');
    assert.ok(dowel);
    assert.ok(dowel.volumes.every(v => v.type === 'normal_part' && v.volume > 0));
    for (const part of ['upper', 'lower']) {
      const half = result.createdObjects.find(o => o.part === part);
      assert.ok(half.volumes.some(v => v.type === 'negative_part' && v.volume < 0));
    }
  });

  test('transformed plate assignment with connectors updates plates without loss', async () => {
    await core.call('addPlate', { name: 'Plate 2' });
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const instId = tree.objects[0].instances[0].id;

    // Move instance to Plate 2 (origin [360, 0, 0], bed center [150, 150]) -> [510, 150, 0]
    // Since cube is [0..20, 0..20], world bounding box is [510..530, 150..170], center is [520, 160, 10]
    await core.call('setInstanceTransform', {
      objectId: objId,
      instanceId: instId,
      offset: [510.0, 150.0, 0.0]
    });

    const platesBefore = await core.call('listPlates', {});
    assert.equal(platesBefore.length, 2);
    const p1Before = platesBefore[1].instances.map(i => i.instanceId);
    assert.ok(p1Before.includes(instId), 'instance must be on Plate 2 before cut');

    // Cut with plug connector at center of translated instance [520, 160, 10]
    const cutRes = await core.call('cutObjectWithConnectors', {
      objectId: objId,
      z: 10.0,
      coordinateSystem: 'world',
      connectors: [
        {
          pos: [520.0, 160.0, 10.0],
          attrs: { type: 'plug', size: 3.0, depthRatio: 4.0, targetHalf: 'upper' }
        }
      ]
    });
    assert.equal(cutRes.success, true);
    assert.equal(cutRes.fitValidated, false);

    // Verify plate assignments: both cut objects are on Plate 2, not Plate 1
    const platesAfter = await core.call('listPlates', {});
    assert.equal(platesAfter.length, 2);
    const plate1Ids = platesAfter[1].instances.map(i => i.objectId);
    const plate0Ids = platesAfter[0].instances.map(i => i.objectId);

    for (const co of cutRes.createdObjects) {
      assert.ok(plate1Ids.includes(co.id), `cut object ${co.id} must be assigned to Plate 2`);
      assert.ok(!plate0Ids.includes(co.id), `Plate 1 must not contain cut object ${co.id}`);
    }
  });

  test('actual slicing of socket reveals negative cavity with reduced material versus solid cut', async () => {
    // 1. Slice plain lower half as baseline
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree1 = await core.call('getObjectTree', {});
    const plainCut = await core.call('cutObject', {
      objectId: tree1.objects[0].id,
      z: 10.0,
      keepUpper: false,
      keepLower: true
    });
    assert.equal(plainCut.success, true);

    const plainSlice = await core.call('slice', { outPath: '/out/plain_lower.gcode', threads: 4 });
    assert.ok(plainSlice.layers > 0, 'plain lower half must produce layers');
    assert.ok(plainSlice.filamentMm > 0, 'plain lower half must consume filament');

    // 2. Cut fresh cube with connector plug at z = 10.0
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree2 = await core.call('getObjectTree', {});
    // Select the newly loaded cube (last object)
    const newObjId = tree2.objects[tree2.objects.length - 1].id;

    const cutRes = await core.call('cutObjectWithConnectors', {
      objectId: newObjId,
      z: 10.0,
      connectors: [
        {
          pos: [10.0, 10.0, 10.0],
          attrs: { type: 'plug', size: 4.0, depthRatio: 5.0, tolerance: 0.1, targetHalf: 'upper' }
        }
      ]
    });
    assert.equal(cutRes.success, true);
    assert.equal(cutRes.fitValidated, false);

    const upperObj = cutRes.createdObjects.find(o => o.part === 'upper');
    const lowerObj = cutRes.createdObjects.find(o => o.part === 'lower');
    assert.ok(upperObj && lowerObj);

    // Delete upper object so we isolate and slice only the socket lower half
    await core.call('deleteObject', { objectId: upperObj.id });
    // Also delete the old plain lower half if still present
    const treeBeforeSlice = await core.call('getObjectTree', {});
    for (const o of treeBeforeSlice.objects) {
      if (o.id !== lowerObj.id) {
        await core.call('deleteObject', { objectId: o.id });
      }
    }

    const socketSlice = await core.call('slice', { outPath: '/out/socket_lower.gcode', threads: 4 });
    assert.ok(socketSlice.layers > 0, 'socket lower half must slice to layers');
    assert.ok(socketSlice.gcodeBytes > 0, 'socket lower half must produce gcode');

    // Parse generated G-code files to inspect slice geometry and toolpath evidence
    const plainGcode = new TextDecoder().decode(core.readFile('/out/plain_lower.gcode'));
    const socketGcode = new TextDecoder().decode(core.readFile('/out/socket_lower.gcode'));

    // Probe 1: Wall blocks count evidence
    // In plain_lower, each of the 50 layers has 2 wall blocks (inner + outer perimeter) = 100 blocks.
    // The 5 mm socket plus 0.1 mm depth clearance reaches Z=4.9 mm.
    // Its 26 cavity layers add two wall contours each = 152 blocks total.
    const countWallBlocks = (gcode) => {
      let walls = 0;
      for (const line of gcode.split('\n')) {
        if (line.includes(';TYPE:Inner wall') || line.includes(';TYPE:Outer wall')) walls++;
      }
      return walls;
    };
    const plainWalls = countWallBlocks(plainGcode);
    const socketWalls = countWallBlocks(socketGcode);
    assert.equal(plainWalls, 100, 'plain cut must have standard wall blocks');
    assert.equal(socketWalls, 152, 'socket cut must have additional internal hole wall blocks');
    assert.ok(socketWalls > plainWalls, 'socket lower half must generate additional wall contours around cavity');

    // Probe 2: Decisive toolpath cavity evidence at Z=8.0 mm (inside the 5mm deep cavity)
    // Socket G-code traces hole perimeter moves around (10, 10) at radius ~2.0-3.0 mm.
    const getCavityWallMoves = (gcode, targetZ) => {
      const lines = gcode.split('\n');
      let atTargetZ = false;
      let isWall = false;
      const holeMoves = [];
      for (const l of lines) {
        if (l === `;Z:${targetZ}`) atTargetZ = true;
        else if (l.startsWith(';Z:') && atTargetZ) atTargetZ = false;
        if (atTargetZ) {
          if (l.startsWith(';TYPE:Inner wall') || l.startsWith(';TYPE:Outer wall') || l.startsWith(';TYPE:Internal perimeter')) {
            isWall = true;
          } else if (l.startsWith(';TYPE:')) {
            isWall = false;
          }
          if (isWall && l.startsWith('G1 ') && l.includes('X') && l.includes('Y')) {
            const xm = l.match(/X([0-9.]+)/);
            const ym = l.match(/Y([0-9.]+)/);
            if (xm && ym) {
              const dist = Math.hypot(parseFloat(xm[1]) - 10, parseFloat(ym[1]) - 10);
              if (dist < 3.5) holeMoves.push(dist);
            }
          }
        }
      }
      return holeMoves;
    };

    const socketCavityMoves = getCavityWallMoves(socketGcode, 8);
    const plainCavityMoves = getCavityWallMoves(plainGcode, 8);
    assert.ok(socketCavityMoves.length >= 20, 'socket G-code must contain circular perimeter moves around cavity at Z=8');
    assert.equal(plainCavityMoves.length, 0, 'plain G-code must have zero cavity boundary moves at Z=8');

    // Probe 3: Minimal G-code segment parser & cavity clearance probe at Z=8.0 mm
    // Tracks modal XY coordinates and relative/absolute E extrusion mode (M82/M83, G92).
    // Evaluates ALL positive extrusion XY segments regardless of wall/infill classification.
    const distanceToSegment = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-12) {
        return Math.hypot(px - ax, py - ay);
      }
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      return Math.hypot(px - projX, py - projY);
    };

    const probeExtrusionSegments = (gcode, targetZ, center, radius) => {
      let isRelativeE = false;
      let currX = 0;
      let currY = 0;
      let currE = 0;
      let atTargetZ = false;
      let segmentsAtZ = 0;
      let minDistance = Infinity;
      const crossingSegments = [];

      for (const rawLine of gcode.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('M82')) {
          isRelativeE = false;
          continue;
        }
        if (line.startsWith('M83')) {
          isRelativeE = true;
          continue;
        }
        if (line.startsWith('G92')) {
          const eMatch = line.match(/(?:^|\s)E(-?[0-9]*\.?[0-9]+)/);
          if (eMatch) {
            currE = parseFloat(eMatch[1]);
          }
          continue;
        }

        const zMatch = line.match(/^;Z:\s*([0-9.]+)/);
        if (zMatch) {
          const zVal = parseFloat(zMatch[1]);
          atTargetZ = Math.abs(zVal - targetZ) < 1e-3;
          continue;
        }

        if (line.startsWith('G0') || line.startsWith('G1')) {
          const code = line.split(';')[0];
          const xMatch = code.match(/(?:^|\s)X(-?[0-9]*\.?[0-9]+)/);
          const yMatch = code.match(/(?:^|\s)Y(-?[0-9]*\.?[0-9]+)/);
          const eMatch = code.match(/(?:^|\s)E(-?[0-9]*\.?[0-9]+)/);

          const startX = currX;
          const startY = currY;

          if (xMatch) currX = parseFloat(xMatch[1]);
          if (yMatch) currY = parseFloat(yMatch[1]);

          let dE = 0;
          if (eMatch) {
            const targetE = parseFloat(eMatch[1]);
            dE = isRelativeE ? targetE : targetE - currE;
            currE = targetE;
          }

          if (atTargetZ && dE > 1e-5) {
            const moveLen = Math.hypot(currX - startX, currY - startY);
            if (moveLen > 1e-5) {
              segmentsAtZ++;
              const dist = distanceToSegment(center.x, center.y, startX, startY, currX, currY);
              if (dist < minDistance) {
                minDistance = dist;
              }
              if (dist < radius) {
                crossingSegments.push({
                  start: { x: startX, y: startY },
                  end: { x: currX, y: currY },
                  dist,
                  dE
                });
              }
            }
          }
        }
      }

      return { segmentsAtZ, minDistance, crossingSegments };
    };

    // Synthetic test: proves endpoint-outside segment-through-center detection works.
    // Endpoints (0, 10) and (20, 10) are at distance 10.0 (> 1.4), but the line segment
    // passes directly through (10, 10) with distance 0.0.
    const syntheticCenter = { x: 10, y: 10 };
    const syntheticGcode = [
      'M83',
      ';Z:8',
      'G1 X0 Y10',
      'G1 X20 Y10 E1.0',
      ';Z:8.2'
    ].join('\n');
    const syntheticProbe = probeExtrusionSegments(syntheticGcode, 8, syntheticCenter, 1.4);
    assert.equal(syntheticProbe.segmentsAtZ, 1, 'synthetic move must be parsed as positive extrusion at Z=8');
    assert.equal(syntheticProbe.crossingSegments.length, 1, 'segment passing through center must be detected');
    assert.ok(syntheticProbe.minDistance < 1e-4, 'segment passing through center must have distance ~0');
    assert.ok(
      Math.hypot(0 - syntheticCenter.x, 10 - syntheticCenter.y) > 1.4 &&
      Math.hypot(20 - syntheticCenter.x, 10 - syntheticCenter.y) > 1.4,
      'synthetic endpoints are outside void radius, proving segment-to-center detection works'
    );

    // Socket G-code: zero positive extrusion segments (wall or infill) may cross the r < 1.4 mm core
    const socketCoreProbe = probeExtrusionSegments(socketGcode, 8, { x: 10, y: 10 }, 1.4);
    assert.ok(socketCoreProbe.segmentsAtZ > 0, 'socket slice must contain extrusion moves at Z=8');
    assert.equal(
      socketCoreProbe.crossingSegments.length,
      0,
      'socket cavity must avoid any extrusions crossing r < 1.4 core at Z=8'
    );
    assert.ok(
      socketCoreProbe.minDistance >= 1.4,
      `socket extrusions must maintain clearance from center (got minDistance ${socketCoreProbe.minDistance})`
    );

    // Positive control: plain solid cut G-code MUST show extrusion segments crossing r < 1.4 mm core
    const plainCoreProbe = probeExtrusionSegments(plainGcode, 8, { x: 10, y: 10 }, 1.4);
    assert.ok(plainCoreProbe.segmentsAtZ > 0, 'plain solid slice must contain extrusion moves at Z=8');
    assert.ok(
      plainCoreProbe.crossingSegments.length > 0,
      'positive control plain solid must show extrusions crossing the central r < 1.4 core at Z=8'
    );
    assert.ok(
      plainCoreProbe.minDistance < 1.4,
      'positive control plain solid min distance to center must be within r < 1.4'
    );
  });

  test('3MF project roundtrip preserves cut connector objects and exposes volume structure', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;

    const cutRes = await core.call('cutObjectWithConnectors', {
      objectId: objId,
      z: 10.0,
      connectors: [
        {
          pos: [10.0, 10.0, 10.0],
          attrs: { type: 'plug', size: 3.0, depthRatio: 4.0, targetHalf: 'upper' }
        }
      ]
    });
    assert.equal(cutRes.success, true);
    assert.equal(cutRes.createdObjects.length, 2);

    // Save project with cut connector objects
    const saveRes = await core.call('saveProject', { path: '/out/connectors_roundtrip.3mf' });
    assert.ok(saveRes, 'saveProject must succeed');

    // Re-open saved 3MF project
    const openRes = await core.call('openProject', { path: '/out/connectors_roundtrip.3mf' });
    assert.equal(openRes.objects.length, 2, '3MF roundtrip must restore both cut halves');

    const treeReloaded = await core.call('getObjectTree', {});
    assert.equal(treeReloaded.objects.length, 2, 'reloaded tree must contain 2 objects');

    // Verify volumes survive roundtrip
    for (const ro of treeReloaded.objects) {
      assert.ok(ro.volumes.length >= 1, 'each object must preserve volumes');
      const mesh = await core.call('getMesh', { objectId: ro.id });
      assert.ok(mesh.vertexCount > 0, 'each object must have valid mesh vertices');
      assert.ok(mesh.triangleCount > 0, 'each object must have valid mesh triangles');
    }

    // Assert real volume roles, geometry and plate assignments roundtrip
    const upperObj = treeReloaded.objects.find(o => o.volumes.some(v => v.type === 'part'));
    const lowerObj = treeReloaded.objects.find(o => o.volumes.some(v => v.type === 'negative'));
    assert.ok(upperObj, 'upper half must have part volumes');
    assert.ok(lowerObj, 'lower half must have negative socket volume');
    assert.ok(
      lowerObj.volumes.some(v => v.type === 'negative' && v.name && v.name.includes('Connector')),
      'negative socket volume metadata must be preserved in lower half'
    );

    const plates = await core.call('listPlates', {});
    assert.ok(plates.length >= 1, 'plate list must exist after roundtrip');
    const plate0ObjIds = plates[0].instances.map(i => i.objectId);
    assert.ok(plate0ObjIds.includes(upperObj.id), 'upper object must remain assigned to plate');
    assert.ok(plate0ObjIds.includes(lowerObj.id), 'lower object must remain assigned to plate');
  });
});
