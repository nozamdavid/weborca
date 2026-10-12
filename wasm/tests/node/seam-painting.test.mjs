import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The mesh is in the object's own model file (desktop Save project layout).
function meshModelPath(extractDir) {
  const objectsDir = path.join(extractDir, '3D', 'Objects');
  const files = fs.existsSync(objectsDir) ? fs.readdirSync(objectsDir).filter((f) => f.endsWith('.model')) : [];
  assert.equal(files.length, 1, 'Fixture must contain one object model file');
  return path.join(objectsDir, files[0]);
}
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
const scratchDir = path.join(bundleDir, 'scratch_seam');

function extractOuterWallSeamStarts(gcodeText) {
  const seamStarts = [];
  let isOuterWall = false;
  let inOuterWallLoop = false;
  let currentX = 0;
  let currentY = 0;
  let currentZ = 0;

  for (const line of gcodeText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';TYPE:')) {
      isOuterWall = trimmed.startsWith(';TYPE:Outer wall') || trimmed.startsWith(';TYPE:Perimeter');
      inOuterWallLoop = false;
      continue;
    }
    if (trimmed.startsWith('G0 ') || trimmed.startsWith('G1 ')) {
      const matchX = / X([0-9.-]+)/.exec(trimmed);
      const matchY = / Y([0-9.-]+)/.exec(trimmed);
      const matchZ = / Z([0-9.-]+)/.exec(trimmed);
      const hasE = / E([0-9.-]+)/.test(trimmed);

      const nextX = matchX ? parseFloat(matchX[1]) : currentX;
      const nextY = matchY ? parseFloat(matchY[1]) : currentY;
      if (matchZ) currentZ = parseFloat(matchZ[1]);

      if (isOuterWall && hasE && (nextX !== currentX || nextY !== currentY)) {
        if (!inOuterWallLoop) {
          seamStarts.push({ x: currentX, y: currentY, z: currentZ });
          inOuterWallLoop = true;
        }
      }
      currentX = nextX;
      currentY = nextY;
    }
  }
  return seamStarts;
}

describe('Orca WASM Engine Seam Painting Test Suite', () => {
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
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });

  test('selected triangle annotation, readback, and clear on object volume', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    assert.ok(tree.objects.length >= 1, 'Object must exist');

    const obj = tree.objects[0];
    const objectId = obj.id;
    const vol = obj.volumes[0];
    const volumeId = vol.id;

    // 1. Initial readback: clean volume with 12 triangles
    const initialPaint = await core.call('getSeamPainting', { objectId, volumeId });
    assert.equal(initialPaint.objectId, objectId);
    assert.equal(initialPaint.volumeId, volumeId);
    assert.equal(initialPaint.triangleCount, 12, 'Standard cube must have 12 triangles');
    assert.equal(initialPaint.hasCustomSeam, false);
    assert.equal(initialPaint.enforcers.length, 0);
    assert.equal(initialPaint.blockers.length, 0);
    assert.equal(initialPaint.facets.length, 0);

    // 2. Set facet 0 as ENFORCER, facet 1 as BLOCKER
    const setRes = await core.call('setSeamPainting', {
      objectId,
      volumeId,
      facets: [
        { facetId: 0, state: 'enforcer' },
        { facetId: 1, state: 'blocker' }
      ]
    });
    assert.equal(setRes.updated, true);
    assert.equal(setRes.modifiedCount, 2);

    // 3. Readback and verify
    const readAfterSet = await core.call('getSeamPainting', {
      objectId,
      volumeId,
      facetIds: [0, 1, 2]
    });
    assert.equal(readAfterSet.hasCustomSeam, true);
    assert.deepEqual(readAfterSet.enforcers, [0]);
    assert.deepEqual(readAfterSet.blockers, [1]);
    assert.equal(readAfterSet.statistics.enforcersCount, 1);
    assert.equal(readAfterSet.statistics.blockersCount, 1);
    assert.equal(readAfterSet.statistics.totalPainted, 2);

    assert.ok(Array.isArray(readAfterSet.queriedFacets));
    assert.equal(readAfterSet.queriedFacets.length, 3);
    assert.equal(readAfterSet.queriedFacets[0].facetId, 0);
    assert.equal(readAfterSet.queriedFacets[0].state, 'enforcer');
    assert.equal(readAfterSet.queriedFacets[0].type, 1);
    assert.equal(readAfterSet.queriedFacets[1].facetId, 1);
    assert.equal(readAfterSet.queriedFacets[1].state, 'blocker');
    assert.equal(readAfterSet.queriedFacets[1].type, 2);
    assert.equal(readAfterSet.queriedFacets[2].facetId, 2);
    assert.equal(readAfterSet.queriedFacets[2].state, 'none');
    assert.equal(readAfterSet.queriedFacets[2].type, 0);

    // 4. Clear individual facet 0
    await core.call('setSeamPainting', {
      objectId,
      volumeId,
      facets: [{ facetId: 0, state: 'clear' }]
    });

    const readAfterFacetClear = await core.call('getSeamPainting', { objectId, volumeId });
    assert.equal(readAfterFacetClear.hasCustomSeam, true);
    assert.equal(readAfterFacetClear.enforcers.length, 0);
    assert.deepEqual(readAfterFacetClear.blockers, [1]);

    // 5. Clear all seam painting on volume
    const clearRes = await core.call('clearSeamPainting', { objectId, volumeId });
    assert.equal(clearRes.cleared, true);

    const readAfterFullClear = await core.call('getSeamPainting', { objectId, volumeId });
    assert.equal(readAfterFullClear.hasCustomSeam, false);
    assert.equal(readAfterFullClear.enforcers.length, 0);
    assert.equal(readAfterFullClear.blockers.length, 0);
    assert.equal(readAfterFullClear.facets.length, 0);
  });

  test('invalid facet input is rejected without mutating prior annotations', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objectId = tree.objects[0].id;
    const volumeId = tree.objects[0].volumes[0].id;

    // Establish prior valid state: facet 2 as enforcer, facet 3 as blocker
    await core.call('setSeamPainting', {
      objectId,
      volumeId,
      facets: [
        { facetId: 2, state: 'enforcer' },
        { facetId: 3, state: 'blocker' }
      ]
    });

    const beforeAttempt = await core.call('getSeamPainting', { objectId, volumeId });
    assert.deepEqual(beforeAttempt.enforcers, [2]);
    assert.deepEqual(beforeAttempt.blockers, [3]);

    // Attempt invalid facetId (out of bounds: facet 9999 on 12-facet cube)
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          facets: [
            { facetId: 4, state: 'enforcer' },
            { facetId: 9999, state: 'enforcer' }
          ]
        });
      },
      /Invalid facet index/
    );

    // Prior state must be completely untouched (facet 4 must NOT be painted)
    const afterBadIndex = await core.call('getSeamPainting', { objectId, volumeId });
    assert.deepEqual(afterBadIndex.enforcers, [2], 'Prior enforcer must remain untouched');
    assert.deepEqual(afterBadIndex.blockers, [3], 'Prior blocker must remain untouched');

    // Attempt negative facetId in setSeamPainting
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          facets: [{ facetId: -1, state: 'enforcer' }]
        });
      },
      /Invalid facet index/
    );

    // Attempt fractional facetId in setSeamPainting
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          facets: [{ facetId: 2.5, state: 'enforcer' }]
        });
      },
      /must contain an integer 'facetId'/
    );

    // Attempt fractional facetId in convenience arrays
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          enforcers: [1.5]
        });
      },
      /must be integers/
    );

    // Attempt negative facetId in convenience arrays
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          blockers: [-1]
        });
      },
      /Invalid facet index/
    );

    // Attempt invalid state value
    await assert.rejects(
      async () => {
        await core.call('setSeamPainting', {
          objectId,
          volumeId,
          facets: [{ facetId: 4, state: 'unsupported_state_xyz' }]
        });
      },
      /Invalid seam painting state/
    );

    // Attempt invalid facetIds query in getSeamPainting (negative, fractional, out of bounds)
    await assert.rejects(
      async () => {
        await core.call('getSeamPainting', {
          objectId,
          volumeId,
          facetIds: [-1]
        });
      },
      /Invalid facet index/
    );

    await assert.rejects(
      async () => {
        await core.call('getSeamPainting', {
          objectId,
          volumeId,
          facetIds: [1.5]
        });
      },
      /must be integers/
    );

    await assert.rejects(
      async () => {
        await core.call('getSeamPainting', {
          objectId,
          volumeId,
          facetIds: [9999]
        });
      },
      /Invalid facet index/
    );

    // Prior state still untouched
    const afterAllBad = await core.call('getSeamPainting', { objectId, volumeId });
    assert.deepEqual(afterAllBad.enforcers, [2]);
    assert.deepEqual(afterAllBad.blockers, [3]);
  });

  test('annotations survive project save/open with exact object and volume assignment', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree1 = await core.call('getObjectTree', {});
    const objectId1 = tree1.objects[0].id;
    const volumeId1 = tree1.objects[0].volumes[0].id;

    // Set annotations: enforcer on 0, 4; blocker on 1
    await core.call('setSeamPainting', {
      objectId: objectId1,
      volumeId: volumeId1,
      facets: [
        { facetId: 0, state: 'enforcer' },
        { facetId: 4, state: 'enforcer' },
        { facetId: 1, state: 'blocker' }
      ]
    });

    // Save project to 3MF
    const savePath = '/out/seam_paint_roundtrip.3mf';
    const saveRes = await core.call('saveProject', { path: savePath });
    assert.ok(saveRes.path, 'saveProject must return path');

    // Open project back
    const openRes = await core.call('openProject', { path: savePath });
    assert.ok(openRes.objects && openRes.objects.length >= 1, 'openProject must return objects');

    const tree2 = await core.call('getObjectTree', {});
    const objectId2 = tree2.objects[0].id;
    const volumeId2 = tree2.objects[0].volumes[0].id;

    // Readback annotations on reopened project
    const readReopened = await core.call('getSeamPainting', {
      objectId: objectId2,
      volumeId: volumeId2
    });

    assert.equal(readReopened.hasCustomSeam, true, 'Custom seam must survive 3MF round-trip');
    assert.deepEqual(readReopened.enforcers.sort(), [0, 4], 'Enforcer facets must survive exactly');
    assert.deepEqual(readReopened.blockers.sort(), [1], 'Blocker facets must survive exactly');
    assert.equal(readReopened.triangleCount, 12, 'Triangle count must match');
  });

  test('split-facet imported annotations are read and preserved when updating untouched facets', async () => {
    // 1. Create a 3MF containing split facet annotation on facet 0
    await core.call('loadModel', { path: '/models/cube.obj' });
    const initTree = await core.call('getObjectTree', {});
    const initObjId = initTree.objects[0].id;
    const initVolId = initTree.objects[0].volumes[0].id;

    await core.call('setSeamPainting', {
      objectId: initObjId,
      volumeId: initVolId,
      facets: [{ facetId: 0, state: 'enforcer' }]
    });

    const base3mfPath = '/out/base_seam_split_fixture.3mf';
    await core.call('saveProject', { path: base3mfPath });
    const base3mfBytes = core.readFile(base3mfPath);

    const testDir = path.join(scratchDir, 'split_test');
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });

    const localZip = path.join(testDir, 'source.3mf');
    fs.writeFileSync(localZip, base3mfBytes);
    const extractDir = path.join(testDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('unzip', ['-q', localZip, '-d', extractDir]);

    // Modify the object model file: replace paint_seam="4" with split annotation "041" (split root with enforcer leaf)
    const modelPath = meshModelPath(extractDir);
    let modelXml = fs.readFileSync(modelPath, 'utf8');
    assert.ok(modelXml.includes('paint_seam="4"'), 'Fixture must contain paint_seam="4"');
    modelXml = modelXml.replace('paint_seam="4"', 'paint_seam="041"');
    fs.writeFileSync(modelPath, modelXml, 'utf8');

    const modifiedZip = path.join(testDir, 'modified.3mf');
    execFileSync('zip', ['-q', '-r', modifiedZip, '.'], { cwd: extractDir });

    core.writeFile('/models/seam_split_imported.3mf', fs.readFileSync(modifiedZip));

    // 2. Open project with imported split facet annotation
    await core.call('openProject', { path: '/models/seam_split_imported.3mf' });
    const openedTree = await core.call('getObjectTree', {});
    const objId = openedTree.objects[0].id;
    const volId = openedTree.objects[0].volumes[0].id;

    const readSplit = await core.call('getSeamPainting', { objectId: objId, volumeId: volId });
    assert.equal(readSplit.hasCustomSeam, true);
    assert.deepEqual(readSplit.enforcers, [0], 'Split facet 0 must be reported as enforcer');

    // 3. Mutate an untouched facet (facet 5 as blocker)
    await core.call('setSeamPainting', {
      objectId: objId,
      volumeId: volId,
      facets: [{ facetId: 5, state: 'blocker' }]
    });

    const readAfterMutate = await core.call('getSeamPainting', { objectId: objId, volumeId: volId });
    assert.deepEqual(readAfterMutate.enforcers, [0], 'Split facet 0 must remain enforcer');
    assert.deepEqual(readAfterMutate.blockers, [5], 'Facet 5 must be blocker');

    // 4. Save and inspect that facet 0 retains exact split hex "041"
    const resavedPath = '/out/seam_split_resaved.3mf';
    await core.call('saveProject', { path: resavedPath });
    const resavedBytes = core.readFile(resavedPath);
    const resavedZip = path.join(testDir, 'resaved.3mf');
    fs.writeFileSync(resavedZip, resavedBytes);
    const resavedExtractDir = path.join(testDir, 'resaved_extracted');
    fs.mkdirSync(resavedExtractDir, { recursive: true });
    execFileSync('unzip', ['-q', resavedZip, '-d', resavedExtractDir]);

    const resavedModelXml = fs.readFileSync(meshModelPath(resavedExtractDir), 'utf8');
    assert.ok(
      resavedModelXml.includes('paint_seam="041"'),
      'Untouched split annotation "041" must be preserved in 3MF archive'
    );
    assert.ok(
      resavedModelXml.includes('paint_seam="8"'),
      'Newly painted facet 5 blocker "8" must be present in 3MF archive'
    );
  });

  test('seam painting influences actual seam placement comparing outer-wall seam start coordinates', async () => {
    // Load standard 20mm cube
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objectId = tree.objects[0].id;
    const volumeId = tree.objects[0].volumes[0].id;

    // Configure deterministic slice settings:
    // seam_position: 'rear' places default seam on rear face (y >= 155 on a 300x300 bed with cube at center 150,150)
    // seam_slope_type: 'none' ensures outer wall loop starts exactly at seam
    await core.call('setOptions', {
      options: {
        seam_position: 'rear',
        seam_slope_type: 'none',
        enable_support: '0',
        slice_closing_radius: '0.049'
      }
    });

    // 1. Slice default baseline without seam painting
    const defaultSlice = await core.call('slice', {
      outPath: '/out/cube_default_seam.gcode',
      threads: 4
    });
    assert.ok(defaultSlice.gcodePath, 'Default slice must succeed');
    const defaultGcodeText = new TextDecoder('utf-8').decode(core.readFile('/out/cube_default_seam.gcode'));
    const defaultSeamStarts = extractOuterWallSeamStarts(defaultGcodeText);
    assert.ok(defaultSeamStarts.length > 0, 'Must have outer wall loops');

    // On Voron 300x300 bed with cube centered at ~150, 150 (extent ~140 to 160):
    // rear seam puts Y around ~160
    const avgDefaultY = defaultSeamStarts.reduce((acc, s) => acc + s.y, 0) / defaultSeamStarts.length;

    // 2. Paint front face (facets 6 and 7 of 20mm_cube.obj: vertices at y=0, front side) as seam ENFORCER
    await core.call('setSeamPainting', {
      objectId,
      volumeId,
      facets: [
        { facetId: 6, state: 'enforcer' },
        { facetId: 7, state: 'enforcer' }
      ]
    });

    // 3. Slice with seam enforcers on front face
    const enforcedSlice = await core.call('slice', {
      outPath: '/out/cube_enforced_seam.gcode',
      threads: 4
    });
    assert.ok(enforcedSlice.gcodePath, 'Slice with seam enforcers must succeed');
    const enforcedGcodeText = new TextDecoder('utf-8').decode(core.readFile('/out/cube_enforced_seam.gcode'));
    const enforcedSeamStarts = extractOuterWallSeamStarts(enforcedGcodeText);
    assert.ok(enforcedSeamStarts.length > 0, 'Must have outer wall loops');

    const avgEnforcedY = enforcedSeamStarts.reduce((acc, s) => acc + s.y, 0) / enforcedSeamStarts.length;

    // Front face has lower Y than rear face by approximately 20mm (cube dimension)
    // Verify that the enforced seam starts shifted to the front face!
    assert.ok(
      avgDefaultY - avgEnforcedY > 10,
      `Painting front face as seam enforcer must move seam start positions to front face. Default Y avg: ${avgDefaultY}, Enforced Y avg: ${avgEnforcedY}`
    );

    // 4. Clear seam painting and verify seam positions revert back to default
    const clearRes = await core.call('clearSeamPainting', { objectId, volumeId });
    assert.equal(clearRes.cleared, true);

    const clearedSlice = await core.call('slice', {
      outPath: '/out/cube_cleared_seam.gcode',
      threads: 4
    });
    assert.ok(clearedSlice.gcodePath, 'Slice after clear must succeed');
    const clearedGcodeText = new TextDecoder('utf-8').decode(core.readFile('/out/cube_cleared_seam.gcode'));
    const clearedSeamStarts = extractOuterWallSeamStarts(clearedGcodeText);
    assert.ok(clearedSeamStarts.length > 0, 'Must have outer wall loops');

    const avgClearedY = clearedSeamStarts.reduce((acc, s) => acc + s.y, 0) / clearedSeamStarts.length;
    assert.ok(
      Math.abs(avgClearedY - avgDefaultY) < 1.0,
      `Clearing seam painting must revert seam starts to default position. Default Y avg: ${avgDefaultY}, Cleared Y avg: ${avgClearedY}`
    );
  });
});
