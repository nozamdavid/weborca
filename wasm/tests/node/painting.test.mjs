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

describe('Orca WASM Engine Support Painting Test Suite', () => {
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
    const initialPaint = await core.call('getSupportPainting', { objectId, volumeId });
    assert.equal(initialPaint.objectId, objectId);
    assert.equal(initialPaint.volumeId, volumeId);
    assert.equal(initialPaint.triangleCount, 12, 'Standard cube must have 12 triangles');
    assert.equal(initialPaint.hasCustomSupports, false);
    assert.equal(initialPaint.enforcers.length, 0);
    assert.equal(initialPaint.blockers.length, 0);
    assert.equal(initialPaint.facets.length, 0);

    // 2. Set facet 0 as ENFORCER, facet 1 as BLOCKER
    const setRes = await core.call('setSupportPainting', {
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
    const readAfterSet = await core.call('getSupportPainting', {
      objectId,
      volumeId,
      facetIds: [0, 1, 2]
    });
    assert.equal(readAfterSet.hasCustomSupports, true);
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
    await core.call('setSupportPainting', {
      objectId,
      volumeId,
      facets: [{ facetId: 0, state: 'clear' }]
    });

    const readAfterFacetClear = await core.call('getSupportPainting', { objectId, volumeId });
    assert.equal(readAfterFacetClear.hasCustomSupports, true);
    assert.equal(readAfterFacetClear.enforcers.length, 0);
    assert.deepEqual(readAfterFacetClear.blockers, [1]);

    // 5. Clear all support painting on volume
    const clearRes = await core.call('clearSupportPainting', { objectId, volumeId });
    assert.equal(clearRes.cleared, true);

    const readAfterFullClear = await core.call('getSupportPainting', { objectId, volumeId });
    assert.equal(readAfterFullClear.hasCustomSupports, false);
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
    await core.call('setSupportPainting', {
      objectId,
      volumeId,
      facets: [
        { facetId: 2, state: 'enforcer' },
        { facetId: 3, state: 'blocker' }
      ]
    });

    const beforeAttempt = await core.call('getSupportPainting', { objectId, volumeId });
    assert.deepEqual(beforeAttempt.enforcers, [2]);
    assert.deepEqual(beforeAttempt.blockers, [3]);

    // Attempt invalid facetId (out of bounds: facet 9999 on 12-facet cube)
    await assert.rejects(
      async () => {
        await core.call('setSupportPainting', {
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
    const afterBadIndex = await core.call('getSupportPainting', { objectId, volumeId });
    assert.deepEqual(afterBadIndex.enforcers, [2], 'Prior enforcer must remain untouched');
    assert.deepEqual(afterBadIndex.blockers, [3], 'Prior blocker must remain untouched');

    // Attempt negative facetId in setSupportPainting
    await assert.rejects(
      async () => {
        await core.call('setSupportPainting', {
          objectId,
          volumeId,
          facets: [{ facetId: -1, state: 'enforcer' }]
        });
      },
      /Invalid facet index/
    );

    // Attempt fractional facetId in setSupportPainting
    await assert.rejects(
      async () => {
        await core.call('setSupportPainting', {
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
        await core.call('setSupportPainting', {
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
        await core.call('setSupportPainting', {
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
        await core.call('setSupportPainting', {
          objectId,
          volumeId,
          facets: [{ facetId: 4, state: 'unsupported_state_xyz' }]
        });
      },
      /Invalid support painting state/
    );

    // Attempt invalid facetIds query in getSupportPainting (negative, fractional, out of bounds)
    await assert.rejects(
      async () => {
        await core.call('getSupportPainting', {
          objectId,
          volumeId,
          facetIds: [-1]
        });
      },
      /Invalid facet index/
    );

    await assert.rejects(
      async () => {
        await core.call('getSupportPainting', {
          objectId,
          volumeId,
          facetIds: [1.5]
        });
      },
      /must be integers/
    );

    await assert.rejects(
      async () => {
        await core.call('getSupportPainting', {
          objectId,
          volumeId,
          facetIds: [9999]
        });
      },
      /Invalid facet index/
    );

    // Prior state still untouched
    const afterAllBad = await core.call('getSupportPainting', { objectId, volumeId });
    assert.deepEqual(afterAllBad.enforcers, [2]);
    assert.deepEqual(afterAllBad.blockers, [3]);
  });

  test('annotations survive project save/open with exact object and volume assignment', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree1 = await core.call('getObjectTree', {});
    const objectId1 = tree1.objects[0].id;
    const volumeId1 = tree1.objects[0].volumes[0].id;

    // Set annotations: enforcer on 0, 4; blocker on 1
    await core.call('setSupportPainting', {
      objectId: objectId1,
      volumeId: volumeId1,
      facets: [
        { facetId: 0, state: 'enforcer' },
        { facetId: 4, state: 'enforcer' },
        { facetId: 1, state: 'blocker' }
      ]
    });

    // Save project to 3MF
    const savePath = '/out/support_paint_roundtrip.3mf';
    const saveRes = await core.call('saveProject', { path: savePath });
    assert.ok(saveRes.path, 'saveProject must return path');

    // Open project back
    const openRes = await core.call('openProject', { path: savePath });
    assert.ok(openRes.objects && openRes.objects.length >= 1, 'openProject must return objects');

    const tree2 = await core.call('getObjectTree', {});
    const objectId2 = tree2.objects[0].id;
    const volumeId2 = tree2.objects[0].volumes[0].id;

    // Readback annotations on reopened project
    const readReopened = await core.call('getSupportPainting', {
      objectId: objectId2,
      volumeId: volumeId2
    });

    assert.equal(readReopened.hasCustomSupports, true, 'Custom supports must survive 3MF round-trip');
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

    await core.call('setSupportPainting', {
      objectId: initObjId,
      volumeId: initVolId,
      facets: [{ facetId: 0, state: 'enforcer' }]
    });

    const base3mfPath = '/out/base_split_fixture.3mf';
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

    // Modify 3D/3dmodel.model: replace paint_supports="4" with split annotation "041" (split root with enforcer leaf)
    const modelPath = path.join(extractDir, '3D', '3dmodel.model');
    let modelXml = fs.readFileSync(modelPath, 'utf8');
    assert.ok(modelXml.includes('paint_supports="4"'), 'Fixture must contain paint_supports="4"');
    modelXml = modelXml.replace('paint_supports="4"', 'paint_supports="041"');
    fs.writeFileSync(modelPath, modelXml, 'utf8');

    const modifiedZip = path.join(testDir, 'modified.3mf');
    execFileSync('zip', ['-q', '-r', modifiedZip, '.'], { cwd: extractDir });
    core.writeFile('/models/split_imported.3mf', fs.readFileSync(modifiedZip));

    // 2. Open project with imported split facet annotation
    await core.call('openProject', { path: '/models/split_imported.3mf' });
    const openedTree = await core.call('getObjectTree', {});
    const objId = openedTree.objects[0].id;
    const volId = openedTree.objects[0].volumes[0].id;

    const readSplit = await core.call('getSupportPainting', { objectId: objId, volumeId: volId });
    assert.equal(readSplit.hasCustomSupports, true);
    assert.deepEqual(readSplit.enforcers, [0], 'Split facet 0 must be reported as enforcer');

    // 3. Mutate an untouched facet (facet 5 as blocker)
    await core.call('setSupportPainting', {
      objectId: objId,
      volumeId: volId,
      facets: [{ facetId: 5, state: 'blocker' }]
    });

    const readAfterMutate = await core.call('getSupportPainting', { objectId: objId, volumeId: volId });
    assert.deepEqual(readAfterMutate.enforcers, [0], 'Split facet 0 must remain enforcer');
    assert.deepEqual(readAfterMutate.blockers, [5], 'Facet 5 must be blocker');

    // 4. Save and inspect that facet 0 retains exact split hex "041"
    const resavedPath = '/out/split_resaved.3mf';
    await core.call('saveProject', { path: resavedPath });
    const resavedBytes = core.readFile(resavedPath);
    const resavedZip = path.join(testDir, 'resaved.3mf');
    fs.writeFileSync(resavedZip, resavedBytes);
    const resavedExtractDir = path.join(testDir, 'resaved_extracted');
    fs.mkdirSync(resavedExtractDir, { recursive: true });
    execFileSync('unzip', ['-q', resavedZip, '-d', resavedExtractDir]);

    const resavedModelXml = fs.readFileSync(path.join(resavedExtractDir, '3D', '3dmodel.model'), 'utf8');
    assert.ok(
      resavedModelXml.includes('paint_supports="041"'),
      'Untouched split annotation "041" must be preserved in 3MF archive'
    );
    assert.ok(
      resavedModelXml.includes('paint_supports="8"'),
      'Newly painted facet 5 blocker "8" must be present in 3MF archive'
    );
  });

  test('support painting influences sliced output on overhang fixture', async () => {
    // Load bridge model (has overhang between z=0 and z=5 spanning x=80 to x=120)
    await core.call('loadModel', { path: '/models/bridge.obj' });
    const tree = await core.call('getObjectTree', {});
    const objectId = tree.objects[0].id;
    const volumeId = tree.objects[0].volumes[0].id;

    // Configure slicing: support enabled with normal(manual) so supports only generate for enforcers
    await core.call('setOptions', {
      options: {
        enable_support: '1',
        support_type: 'normal(manual)',
        bridge_no_support: '0'
      }
    });

    // Run slice without any annotations
    const resNoEnforcers = await core.call('slice', {
      outPath: '/out/bridge_no_enforcer.gcode',
      threads: 4
    });
    assert.ok(resNoEnforcers.gcodePath, 'Slice without enforcers should succeed');
    const gcodeNoEnforcers = core.readFile('/out/bridge_no_enforcer.gcode');
    const textNoEnforcers = new TextDecoder('utf-8').decode(gcodeNoEnforcers);
    const supportExtrusionsNoEnforcers = countSupportGcode(textNoEnforcers);

    // Paint overhang facets 10 and 18 (underside facets of the bridge) as ENFORCER
    await core.call('setSupportPainting', {
      objectId,
      volumeId,
      facets: [
        { facetId: 10, state: 'enforcer' },
        { facetId: 18, state: 'enforcer' }
      ]
    });

    // Run slice with enforcer annotation
    const resWithEnforcer = await core.call('slice', {
      outPath: '/out/bridge_with_enforcer.gcode',
      threads: 4
    });
    assert.ok(resWithEnforcer.gcodePath, 'Slice with enforcer should succeed');
    const gcodeWithEnforcer = core.readFile('/out/bridge_with_enforcer.gcode');
    const textWithEnforcer = new TextDecoder('utf-8').decode(gcodeWithEnforcer);
    const supportExtrusionsWithEnforcer = countSupportGcode(textWithEnforcer);

    // Slicing output must be influenced: support extrusions must be generated when enforcers are present
    assert.equal(
      supportExtrusionsNoEnforcers,
      0,
      'Normal(manual) without enforcers must generate 0 support extrusions'
    );
    assert.ok(
      supportExtrusionsWithEnforcer > 0,
      `Painting an overhang facet as enforcer must generate support extrusions (got ${supportExtrusionsWithEnforcer})`
    );

    // Clear the painting and verify it reverts
    await core.call('clearSupportPainting', { objectId, volumeId });
    await core.call('slice', {
      outPath: '/out/bridge_cleared.gcode',
      threads: 4
    });
    const gcodeCleared = core.readFile('/out/bridge_cleared.gcode');
    const textCleared = new TextDecoder('utf-8').decode(gcodeCleared);
    const supportExtrusionsCleared = countSupportGcode(textCleared);
    assert.equal(
      supportExtrusionsCleared,
      0,
      'Cleared annotation must revert to 0 support extrusions'
    );
  });

  test('getMesh volume partition metadata correctly maps two volumes with nonidentity transforms', async () => {
    await core.call('loadModel', { path: '/models/cube.obj' });
    const tree = await core.call('getObjectTree', {});
    const objId = tree.objects[0].id;
    const vol1Id = tree.objects[0].volumes[0].id;

    // Add second model-part volume with nonidentity transform (offset + size)
    const addVolRes = await core.call('addVolume', {
      objectId: objId,
      type: 'part',
      shape: 'cube',
      size: [10, 10, 10],
      offset: [35, 10, 5]
    });
    const vol2Id = addVolRes.volumeId;

    // Call getMesh and inspect partition metadata
    const meshRes = await core.call('getMesh', { objectId: objId });
    assert.ok(meshRes.path, 'getMesh must return output path');
    assert.equal(meshRes.triangleCount, 24, 'Merged mesh must contain 12 + 12 = 24 triangles');
    assert.ok(Array.isArray(meshRes.volumes), 'getMesh must include volumes partition array');
    assert.equal(meshRes.volumes.length, 2, 'Must contain exactly 2 volume partitions');

    assert.deepEqual(meshRes.volumes[0], {
      volumeId: vol1Id,
      firstFacet: 0,
      facetCount: 12
    });
    assert.deepEqual(meshRes.volumes[1], {
      volumeId: vol2Id,
      firstFacet: 12,
      facetCount: 12
    });

    // Prove partition boundary and local facet mapping
    // Picking merged facet index 15 (which lies in volume 2: [12, 24))
    const pickedMergedFacet = 15;
    const partition = meshRes.volumes.find(
      v => pickedMergedFacet >= v.firstFacet && pickedMergedFacet < v.firstFacet + v.facetCount
    );
    assert.ok(partition, 'Must find partition for facet 15');
    assert.equal(partition.volumeId, vol2Id, 'Facet 15 belongs to volume 2');

    const localFacet = pickedMergedFacet - partition.firstFacet; // 15 - 12 = 3
    assert.equal(localFacet, 3, 'Local facet ID within volume 2 is 3');

    // Paint support enforcer on volume 2 at local facet 3
    await core.call('setSupportPainting', {
      objectId: objId,
      volumeId: vol2Id,
      facets: [{ facetId: localFacet, state: 'enforcer' }]
    });

    // Paint support blocker on volume 1 at local facet 7
    await core.call('setSupportPainting', {
      objectId: objId,
      volumeId: vol1Id,
      facets: [{ facetId: 7, state: 'blocker' }]
    });

    // Verify volume 1 paint
    const paintVol1 = await core.call('getSupportPainting', { objectId: objId, volumeId: vol1Id });
    assert.deepEqual(paintVol1.blockers, [7], 'Volume 1 blocker must be facet 7');
    assert.equal(paintVol1.enforcers.length, 0);

    // Verify volume 2 paint
    const paintVol2 = await core.call('getSupportPainting', { objectId: objId, volumeId: vol2Id });
    assert.deepEqual(paintVol2.enforcers, [3], 'Volume 2 enforcer must be facet 3');
    assert.equal(paintVol2.blockers.length, 0);

    // Clear volume 2 and verify volume 1 remains isolated
    await core.call('clearSupportPainting', { objectId: objId, volumeId: vol2Id });
    const clearVol2 = await core.call('getSupportPainting', { objectId: objId, volumeId: vol2Id });
    assert.equal(clearVol2.hasCustomSupports, false);
    const checkVol1 = await core.call('getSupportPainting', { objectId: objId, volumeId: vol1Id });
    assert.deepEqual(checkVol1.blockers, [7], 'Volume 1 annotations must remain untouched');
  });
});
