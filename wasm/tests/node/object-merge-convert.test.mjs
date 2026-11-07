import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const candidatePaths = [
  process.env.ORCA_ENGINE_MODULE,
  path.join(repoRoot, 'wasm', 'build', 'multipart-volume-api-runtime', 'wasm', 'engine', 'orca_engine.mjs'),
  path.join(repoRoot, 'wasm', 'build', 'orca-step-runtime', 'wasm', 'engine', 'orca_engine.mjs'),
  path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs')
].filter(Boolean);

const modulePath = candidatePaths.find((p) => fs.existsSync(p));

async function createEngine() {
  if (!modulePath) {
    throw new Error('No candidate orca_engine.mjs module found on disk');
  }
  const mod = await import(modulePath);
  const core = await createEngineCore({
    moduleFactory: mod.createOrcaEngine || mod.default,
    threads: 2
  });

  for (const file of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json']) {
    const fullPath = path.join(repoRoot, 'wasm/build/tests-node', file);
    if (fs.existsSync(fullPath)) {
      await core.addVendorBundle(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    }
  }

  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System', 'Generic PETG @System']
  });

  return core;
}

function assembleMatrix(offset, rotation, scale, mirror) {
  const [tx, ty, tz] = offset || [0, 0, 0];
  const [rx, ry, rz] = rotation || [0, 0, 0];
  const [sx, sy, sz] = scale || [1, 1, 1];
  const [mx, my, mz] = mirror || [1, 1, 1];

  const fx = sx * mx;
  const fy = sy * my;
  const fz = sz * mz;

  const cx = Math.cos(rx), sx_sin = Math.sin(rx);
  const cy = Math.cos(ry), sy_sin = Math.sin(ry);
  const cz = Math.cos(rz), sz_sin = Math.sin(rz);

  // R = Rz * Ry * Rx
  const r00 = cz * cy;
  const r01 = -sz_sin * cx + cz * sy_sin * sx_sin;
  const r02 = sz_sin * sx_sin + cz * sy_sin * cx;

  const r10 = sz_sin * cy;
  const r11 = cz * cx + sz_sin * sy_sin * sx_sin;
  const r12 = -cz * sx_sin + sz_sin * sy_sin * cx;

  const r20 = -sy_sin;
  const r21 = cy * sx_sin;
  const r22 = cy * cx;

  return [
    [r00 * fx, r01 * fy, r02 * fz, tx],
    [r10 * fx, r11 * fy, r12 * fz, ty],
    [r20 * fx, r21 * fy, r22 * fz, tz],
    [0, 0, 0, 1]
  ];
}

function matMul(a, b) {
  const c = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        c[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return c;
}

function applyMat(m, p) {
  const [x, y, z] = p;
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
    m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
    m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3]
  ];
}

describe('Object merge and volume type conversion test suite', () => {
  let core;

  before(async () => {
    if (!modulePath) return;
    core = await createEngine();
  });

  after(() => {
    if (core) core.dispose();
  });

  test('type conversions and last solid refusal', async (t) => {
    if (!core) return t.skip('Engine module unavailable');

    const cubeData = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'));
    await core.loadModel('cube_type_test.obj', cubeData);

    const objects = await core.call('listObjects', {});
    assert.ok(objects.length >= 1);
    const obj = objects[objects.length - 1];
    const objectId = obj.id;

    const treeBefore = await core.call('getObjectTree', {});
    const objNode = treeBefore.objects.find((o) => o.id === objectId);
    assert.ok(objNode && objNode.volumes.length === 1);
    const firstVolId = objNode.volumes[0].id;

    // Refusal on the last solid part: object has only 1 solid part
    await assert.rejects(
      core.call('setVolumeType', { objectId, volumeId: firstVolId, type: 'negative' }),
      /The type of the last solid object part cannot be changed/
    );
    await assert.rejects(
      core.call('setVolumeType', { objectId, volumeId: firstVolId, type: 'modifier' }),
      /The type of the last solid object part cannot be changed/
    );
    await assert.rejects(
      core.call('setVolumeType', { objectId, volumeId: firstVolId, type: 'support_blocker' }),
      /The type of the last solid object part cannot be changed/
    );
    await assert.rejects(
      core.call('setVolumeType', { objectId, volumeId: firstVolId, type: 'support_enforcer' }),
      /The type of the last solid object part cannot be changed/
    );

    // Add a second solid part to allow converting either one
    const addedRes = await core.call('addVolume', {
      objectId,
      type: 'part',
      shape: 'cube',
      size: 10,
      offset: [25, 0, 0],
      name: 'Second Part'
    });
    const secondVolId = addedRes.volumeId || addedRes.id;

    // Convert second volume across all supported volume types
    const typesToTest = ['negative', 'modifier', 'support_blocker', 'support_enforcer', 'part'];
    for (const targetType of typesToTest) {
      const res = await core.call('setVolumeType', { objectId, volumeId: secondVolId, type: targetType });
      assert.equal(res.type, targetType);
      const updatedTree = await core.call('getObjectTree', {});
      const updatedObj = updatedTree.objects.find((o) => o.id === objectId);
      const updatedVol = updatedObj.volumes.find((v) => v.id === secondVolId);
      assert.equal(updatedVol.type, targetType);
    }

    // Now convert second volume to modifier so only first volume is solid
    await core.call('setVolumeType', { objectId, volumeId: secondVolId, type: 'modifier' });
    // First volume is now the only solid part; converting it must be refused
    await assert.rejects(
      core.call('setVolumeType', { objectId, volumeId: firstVolId, type: 'negative' }),
      /The type of the last solid object part cannot be changed/
    );

    // Clean up
    await core.call('deleteInstances', { instances: obj.instances.map((i) => ({ objectId, instanceId: i.id })) });
  });

  test('transform and selected duplicate preservation, metadata retention, atomic invalid merge, plate unaffected, save/reopen', async (t) => {
    if (!core) return t.skip('Engine module unavailable');

    const cubeData = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'));
    await core.loadModel('model_a.obj', cubeData);
    await core.addModel('model_b.obj', cubeData);

    const objs = await core.call('listObjects', {});
    assert.ok(objs.length >= 2);
    const objA = objs[objs.length - 2];
    const objB = objs[objs.length - 1];

    // Give transforms to instances
    const instA0 = objA.instances[0].id;
    const instB0 = objB.instances[0].id;
    await core.call('setInstanceTransform', { objectId: objA.id, instanceId: instA0, offset: [100, 100, 0] });

    // Duplicate instance on objA: now objA has 2 instances
    await core.call('duplicateInstance', { objectId: objA.id, instanceId: instA0 });
    const objsAfterDup = await core.call('listObjects', {});
    const objAUpdated = objsAfterDup.find((o) => o.id === objA.id);
    assert.equal(objAUpdated.instances.length, 2);
    const instA1 = objAUpdated.instances.find((i) => i.id !== instA0).id;

    // Set translation + rotation + nonuniform scale on selected duplicate instA1
    await core.call('setInstanceTransform', {
      objectId: objA.id,
      instanceId: instA1,
      offset: [200, 100, 0],
      rotation: [0, 0, Math.PI / 4],
      scale: [1.2, 0.8, 1.5]
    });

    // Set translation + rotation + nonuniform scale + mirror on selected instB0
    await core.call('setInstanceTransform', {
      objectId: objB.id,
      instanceId: instB0,
      offset: [150, 150, 0],
      rotation: [0.1, 0.2, 0.3],
      scale: [0.9, 1.4, 1.1]
    });
    await core.call('mirrorInstance', { objectId: objB.id, instanceId: instB0, axis: 0 });

    // Add a negative volume with nonzero Z, extruder 2, and custom volume config to objB
    const addedVolB = await core.call('addVolume', {
      objectId: objB.id,
      type: 'negative',
      shape: 'cylinder',
      size: [8, 8, 15],
      offset: [5, 5, 12],
      name: 'Sub-Negative'
    });
    const subVolBId = addedVolB.volumeId || addedVolB.id;
    await core.call('setVolumeExtruder', { objectId: objB.id, volumeId: subVolBId, extruder: 2 });
    await core.call('setObjectConfig', { objectId: objB.id, volumeId: subVolBId, options: { wall_loops: '3' } });

    // Add a second plate and an unrelated object on plate 2 to verify plate membership preservation
    await core.call('addPlate', {});
    await core.addModel('unrelated.obj', cubeData);
    const objsWithUnrelated = await core.call('listObjects', {});
    const objUnrelated = objsWithUnrelated[objsWithUnrelated.length - 1];
    const instUnrelated = objUnrelated.instances[0].id;
    await core.call('setInstanceTransform', {
      objectId: objUnrelated.id,
      instanceId: instUnrelated,
      offset: [460, 100, 0]
    });

    // Snapshot plates before merge
    const platesBefore = await core.call('listPlates', {});
    const plateCount = platesBefore.length;
    assert.equal(plateCount, 2, 'Expected 2 plates before merge');
    assert.ok(platesBefore[0].instances.some((i) => i.instanceId === instA0));
    assert.ok(platesBefore[0].instances.some((i) => i.instanceId === instA1));
    assert.ok(platesBefore[0].instances.some((i) => i.instanceId === instB0));
    assert.ok(platesBefore[1].instances.some((i) => i.instanceId === instUnrelated));

    // Test conflicting object setting preflight refusal and unchanged tree fingerprint
    await core.call('setObjectConfig', { objectId: objB.id, options: { layer_height: '0.28' } });
    const treeBeforeConflict = await core.call('getObjectTree', {});
    await assert.rejects(
      core.call('mergeObjects', {
        instances: [
          { objectId: objA.id, instanceId: instA1 },
          { objectId: objB.id, instanceId: instB0 }
        ]
      }),
      /Cannot merge objects with conflicting setting: layer_height/i
    );
    const treeAfterConflict = await core.call('getObjectTree', {});
    assert.deepEqual(treeAfterConflict, treeBeforeConflict, 'Tree fingerprint must remain completely unchanged after conflicting config refusal');
    await core.call('resetObjectConfig', { objectId: objB.id, options: ['layer_height'] });

    // Test invalid merge atomic: non-existent instance
    await assert.rejects(
      core.call('mergeObjects', {
        instances: [
          { objectId: objA.id, instanceId: instA1 },
          { objectId: 999999, instanceId: 888888 }
        ]
      }),
      /not found|Invalid/i
    );

    // Verify model state is completely atomic and unchanged after failed merge
    const objsAfterFailed = await core.call('listObjects', {});
    const aCheck = objsAfterFailed.find((o) => o.id === objA.id);
    const bCheck = objsAfterFailed.find((o) => o.id === objB.id);
    assert.equal(aCheck.instances.length, 2);
    assert.ok(bCheck);

    // Snapshot pre-merge transforms and volume IDs to verify exact geometry and ID uniqueness
    const objsPreMerge = await core.call('listObjects', {});
    const treeBeforeMerge = await core.call('getObjectTree', {});
    const sourceObjA = treeBeforeMerge.objects.find((o) => o.id === objA.id);
    const sourceObjAVolumeIds = new Set(sourceObjA.volumes.map((v) => v.id));

    const instA0Before = objsPreMerge.find((o) => o.id === objA.id).instances.find((i) => i.id === instA0);
    const instA1Pre = objsPreMerge.find((o) => o.id === objA.id).instances.find((i) => i.id === instA1);
    const instB0Pre = objsPreMerge.find((o) => o.id === objB.id).instances.find((i) => i.id === instB0);

    const matInstA1 = assembleMatrix(instA1Pre.offset, instA1Pre.rotation, instA1Pre.scale, instA1Pre.mirror);
    const matInstB0 = assembleMatrix(instB0Pre.offset, instB0Pre.rotation, instB0Pre.scale, instB0Pre.mirror);

    const volA0Pre = await core.call('getVolume', { objectId: objA.id, volumeId: sourceObjA.volumes[0].id });
    const volB0Pre = await core.call('getVolume', { objectId: objB.id, volumeId: treeBeforeMerge.objects.find((o) => o.id === objB.id).volumes[0].id });
    const volB1Pre = await core.call('getVolume', { objectId: objB.id, volumeId: subVolBId });

    const worldMatA0 = matMul(matInstA1, assembleMatrix(volA0Pre.offset, volA0Pre.rotation, volA0Pre.scale, volA0Pre.mirror));
    const worldMatB0 = matMul(matInstB0, assembleMatrix(volB0Pre.offset, volB0Pre.rotation, volB0Pre.scale, volB0Pre.mirror));
    const worldMatB1 = matMul(matInstB0, assembleMatrix(volB1Pre.offset, volB1Pre.rotation, volB1Pre.scale, volB1Pre.mirror));

    // Now merge instA1 (the duplicate instance of objA) with instB0 (the instance of objB)
    // Selected duplicate preservation: instA0 of objA should be preserved!
    // objB's only instance is consumed, so objB should be deleted.
    const mergeResult = await core.call('mergeObjects', {
      instances: [
        { objectId: objA.id, instanceId: instA1 },
        { objectId: objB.id, instanceId: instB0 }
      ],
      name: 'Merged Assembly'
    });

    assert.ok(mergeResult.objectId || mergeResult.id);
    const mergedId = mergeResult.objectId || mergeResult.id;
    assert.equal(mergeResult.name, 'Merged Assembly');

    const objsAfterMerge = await core.call('listObjects', {});
    const survivingA = objsAfterMerge.find((o) => o.id === objA.id);
    const deletedB = objsAfterMerge.find((o) => o.id === objB.id);
    const mergedObj = objsAfterMerge.find((o) => o.id === mergedId);

    // Verify surviving unmerged instance of objA is preserved with exact transform
    assert.ok(survivingA, 'Original object A should survive because it had unselected instance');
    assert.equal(survivingA.instances.length, 1);
    assert.equal(survivingA.instances[0].id, instA0);
    const survivingInstA0 = survivingA.instances[0];
    assert.deepEqual(survivingInstA0.offset, instA0Before.offset, 'Unselected duplicate offset must be preserved exactly');
    assert.deepEqual(survivingInstA0.rotation, instA0Before.rotation, 'Unselected duplicate rotation must be preserved exactly');
    assert.deepEqual(survivingInstA0.scale, instA0Before.scale, 'Unselected duplicate scale must be preserved exactly');
    assert.deepEqual(survivingInstA0.mirror, instA0Before.mirror, 'Unselected duplicate mirror must be preserved exactly');

    // Verify objB was cleaned up completely
    assert.equal(deletedB, undefined, 'Object B should be deleted as all its instances were merged');

    // Verify merged object exists with preserved volumes (no boolean union, separate volumes retained)
    assert.ok(mergedObj, 'Merged object should exist');
    assert.equal(mergedObj.instances.length, 1);
    assert.ok((mergedObj.volumesCount ?? mergedObj.volumes) >= 3, 'Merged object should retain all source volumes');

    // Assert world geometry before/after for selected instances with translation+rotation+nonuniform scale/mirror and nonzero Z
    const mergedInst = mergedObj.instances[0];
    const matMergedInst = assembleMatrix(mergedInst.offset, mergedInst.rotation, mergedInst.scale, mergedInst.mirror);

    const treeMerged = await core.call('getObjectTree', {});
    const mergedTreeObj = treeMerged.objects.find((o) => o.id === mergedId);
    assert.ok(mergedTreeObj);
    assert.ok(mergedTreeObj.volumes.length >= 3);

    const mergedVolA0 = await core.call('getVolume', { objectId: mergedId, volumeId: mergedTreeObj.volumes[0].id });
    const mergedVolB0 = await core.call('getVolume', { objectId: mergedId, volumeId: mergedTreeObj.volumes[1].id });
    const mergedVolB1 = await core.call('getVolume', { objectId: mergedId, volumeId: mergedTreeObj.volumes[2].id });

    const worldMatMergedA0 = matMul(matMergedInst, assembleMatrix(mergedVolA0.offset, mergedVolA0.rotation, mergedVolA0.scale, mergedVolA0.mirror));
    const worldMatMergedB0 = matMul(matMergedInst, assembleMatrix(mergedVolB0.offset, mergedVolB0.rotation, mergedVolB0.scale, mergedVolB0.mirror));
    const worldMatMergedB1 = matMul(matMergedInst, assembleMatrix(mergedVolB1.offset, mergedVolB1.rotation, mergedVolB1.scale, mergedVolB1.mirror));

    // Assert affine transformation matrices match within 1e-5
    for (const [mPre, mPost, name] of [
      [worldMatA0, worldMatMergedA0, 'Volume A0'],
      [worldMatB0, worldMatMergedB0, 'Volume B0'],
      [worldMatB1, worldMatMergedB1, 'Volume B1 (Sub-Negative)']
    ]) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const diff = Math.abs(mPre[r][c] - mPost[r][c]);
          assert.ok(diff <= 1e-5, `${name} matrix entry [${r}][${c}] diff ${diff} exceeds 1e-5`);
        }
      }
    }

    // Assert actual point/bounds coordinates match within 1e-5
    const testPoints = [
      [0, 0, 0],
      [10, 10, 10],
      [-10, -10, -10],
      [-4, -4, -7.5],
      [4, 4, 7.5]
    ];
    for (const [mPre, mPost, name] of [
      [worldMatA0, worldMatMergedA0, 'Volume A0'],
      [worldMatB0, worldMatMergedB0, 'Volume B0'],
      [worldMatB1, worldMatMergedB1, 'Volume B1 (Sub-Negative)']
    ]) {
      for (const pt of testPoints) {
        const pPre = applyMat(mPre, pt);
        const pPost = applyMat(mPost, pt);
        for (let i = 0; i < 3; i++) {
          const diff = Math.abs(pPre[i] - pPost[i]);
          assert.ok(diff <= 1e-5, `${name} point [${pt}] coordinate [${i}] diff ${diff} exceeds 1e-5`);
        }
      }
    }

    // Verify volume types and metadata retained where API exposes
    const negVol = mergedTreeObj.volumes.find((v) => v.name === 'Sub-Negative' || v.type === 'negative');
    assert.ok(negVol, 'Negative volume from objB must be retained as separate volume');
    assert.equal(negVol.type, 'negative');
    assert.equal(negVol.extruder, 2, 'Volume extruder setting must be preserved on merged volume');
    assert.equal(negVol.config.wall_loops, '3', 'Volume config option wall_loops must be preserved on merged volume');

    // Uniqueness assertion: new merged volume IDs differ from retained source instances before merging and uniqueness within scene
    const mergedVolumeIds = mergedTreeObj.volumes.map((v) => v.id);
    const survivingTreeA = treeMerged.objects.find((o) => o.id === objA.id);
    assert.ok(survivingTreeA, 'Original object A should survive in tree');
    const survivingAVolumeIds = new Set(survivingTreeA.volumes.map((v) => v.id));

    for (const volId of mergedVolumeIds) {
      assert.ok(!sourceObjAVolumeIds.has(volId), `Merged volume ID ${volId} collides with retained source volume before merge`);
      assert.ok(!survivingAVolumeIds.has(volId), `Merged volume ID ${volId} collides with surviving source volume after merge`);
    }

    const allSceneVolumeIds = new Set();
    let totalSceneVolumes = 0;
    for (const o of treeMerged.objects) {
      for (const v of o.volumes) {
        totalSceneVolumes++;
        assert.ok(!allSceneVolumeIds.has(v.id), `Duplicate volume ID ${v.id} in scene`);
        allSceneVolumeIds.add(v.id);
      }
    }
    assert.equal(allSceneVolumeIds.size, totalSceneVolumes, 'All volume IDs in the scene must be globally unique');

    // Plate unaffected and membership check:
    const platesAfter = await core.call('listPlates', {});
    assert.equal(platesAfter.length, plateCount, 'Plate count should be unaffected');
    const p0InstIds = platesAfter[0].instances.map((i) => i.instanceId);
    const p1InstIds = platesAfter[1].instances.map((i) => i.instanceId);
    assert.ok(p0InstIds.includes(instA0), 'Plate 0 must preserve surviving unselected duplicate instance instA0');
    assert.ok(p0InstIds.includes(mergedInst.id), 'Plate 0 must contain the newly created merged instance');
    assert.ok(!p0InstIds.includes(instA1), 'Plate 0 must no longer contain consumed instance instA1');
    assert.ok(!p0InstIds.includes(instB0), 'Plate 0 must no longer contain consumed instance instB0');
    assert.ok(p1InstIds.includes(instUnrelated), 'Plate 1 must preserve unrelated plate instance membership');
    assert.equal(platesAfter[1].instances.find((i) => i.instanceId === instUnrelated).objectId, objUnrelated.id);

    // Save and Reopen roundtrip test
    const savePath = '/out/merged_roundtrip_test.3mf';
    await core.call('saveProject', { path: savePath, compressionLevel: 2 });
    await core.call('openProject', { path: savePath });

    const reopenedObjs = await core.call('listObjects', {});
    const reopenedMerged = reopenedObjs.find((o) => o.name === 'Merged Assembly');
    assert.ok(reopenedMerged, 'Merged assembly should survive save and reopen');
    assert.ok((reopenedMerged.volumesCount ?? reopenedMerged.volumes) >= 3, 'Volumes should survive save and reopen');

    const reopenedTree = await core.call('getObjectTree', {});
    const reopenedTreeObj = reopenedTree.objects.find((o) => o.name === 'Merged Assembly');
    assert.ok(reopenedTreeObj);
    assert.ok(reopenedTreeObj.volumes.some((v) => v.type === 'negative'), 'Negative volume retained after reopen');
  });
});
