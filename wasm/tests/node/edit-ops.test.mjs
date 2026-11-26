import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
      'orca-step-runtime',
      'wasm',
      'engine',
      'orca_engine.mjs'
    );

test('Edit Ops', async (t) => {
    const { default: moduleFactory } = await import(modulePath);
    const engine = await createEngineCore({
      moduleFactory,
      threads: 2
    });

    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    engine.writeFile('/models/cube.obj', cubeBytes);


    const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');
    const orcaFilJsonPath = path.join(bundleDir, 'profiles', 'OrcaFilamentLibrary.json');
    const voronJsonPath = path.join(bundleDir, 'profiles', 'Voron.json');

    await engine.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilJsonPath, 'utf8')));
    await engine.addVendorBundle(JSON.parse(fs.readFileSync(voronJsonPath, 'utf8')));

    await engine.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await engine.call('loadVendors', {});
    await engine.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });


    await t.test('autoOrient and getPlanarFacets / placeOnFace', async () => {

        await engine.call('addModel', { path: '/models/cube.obj' });
        let tree = await engine.call('getObjectTree', {}); let _objs = tree.objects;
        const objId = _objs[_objs.length - 1].id;
        const instId = _objs[_objs.length - 1].instances[0].id;

        
        let health = await engine.call('checkMeshHealth', { objectId: objId });
        assert.equal(health.success, true);
        
        let res = await engine.call('autoOrient', { objectIds: [objId] });
        assert.equal(res.success, true);
        assert.equal(res.rotations.length, 1);
        
        res = await engine.call('getPlanarFacets', { objectId: objId });
        assert.equal(res.success, true);
        assert(res.clusters.length >= 6); 
        
        let smallestFacetIndex = -1;
        let minArea = Infinity;
        for (let i = 0; i < res.clusters.length; i++) {
            if (res.clusters[i].area < minArea) {
                minArea = res.clusters[i].area;
                smallestFacetIndex = i;
            }
        }
        
        await engine.call('setInstanceTransform', { objectId: objId, instanceId: instId, rotation: [0.3, 0.2, 0] });
        const tilted = await engine.call('checkMeshHealth', { objectId: objId });
        assert.ok(tilted.boundingBox[5] - tilted.boundingBox[2] > 25, 'the tilted cube is taller than its 20 mm edge');
        const candidates = await engine.call('getPlanarFacets', { objectId: objId, instanceId: instId });
        for (const cluster of candidates.clusters) {
            assert.ok(cluster.outline.length >= 3);
            for (const vertex of cluster.outline) {
                const distance = vertex.reduce((sum, value, axis) => sum + (value - cluster.center[axis]) * cluster.normal[axis], 0);
                assert.ok(Math.abs(distance) < 0.001, 'candidate outline and normal/center share mesh coordinates on a tilted cube');
            }
        }

        res = await engine.call('placeOnFace', { objectId: objId, instanceId: instId, facetIndex: smallestFacetIndex });
        assert.equal(res.success, true);
        const flat = await engine.call('checkMeshHealth', { objectId: objId });
        assert.ok(Math.abs(flat.boundingBox[5] - flat.boundingBox[2] - 20) < 0.01, 'laid on a face, the cube is 20 mm tall again');

        await engine.call('deleteObject', { objectId: objId });
    });
    

    await t.test('splitObject and splitVolume', async () => {
        // Create an OBJ with 2 disjoint boxes
        const disjointObj = `
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
v 30 0 0
v 40 0 0
v 40 10 0
v 30 10 0
v 30 0 10
v 40 0 10
v 40 10 10
v 30 10 10
f 9 10 11 12
f 13 16 15 14
f 9 13 14 10
f 10 14 15 11
f 11 15 16 12
f 13 9 12 16
`;
        engine.writeFile('/models/disjoint.obj', disjointObj);
        await engine.call('addModel', { path: '/models/disjoint.obj' });
        
        let tree = await engine.call('getObjectTree', {}); let _objs = tree.objects;
        let targetId = _objs[_objs.length - 1].id;
        let volId = _objs[_objs.length - 1].volumes[0].id;
        
        let health = await engine.call('checkMeshHealth', { objectId: targetId });
        assert.equal(health.numberOfParts, 2);
        
        let splitV = await engine.call('splitVolume', { objectId: targetId, volumeId: volId });
        assert.equal(splitV.success, true);
        assert.equal(splitV.newVolumeIds.length, 2);
        
        let splitO = await engine.call('splitObject', { objectId: targetId });
        assert.equal(splitO.success, true);
        assert.equal(splitO.newObjectIds.length, 2);

        for (let id of splitO.newObjectIds) {
            await engine.call('deleteObject', { objectId: id });
        }
    });

    
    await t.test('simplifyVolume', async () => {

        await engine.call('addModel', { path: '/models/cube.obj' });
        let tree = await engine.call('getObjectTree', {}); let _objs = tree.objects;
        let objId = _objs[_objs.length - 1].id;
        let volId = _objs[_objs.length - 1].volumes[0].id;


        let healthBefore = await engine.call('checkMeshHealth', { objectId: objId });
        let facetsBefore = healthBefore.facetsCount;
        
        let simp = await engine.call('simplifyVolume', { objectId: objId, volumeId: volId, ratio: 0.5 });
        assert.equal(simp.success, true);
        assert(simp.triangleCountAfter < facetsBefore);
        
        let healthAfter = await engine.call('checkMeshHealth', { objectId: objId });
        assert.equal(healthAfter.facetsCount, simp.triangleCountAfter);

        await engine.call('deleteObject', { objectId: objId });
    });
    
    await t.test('meshBoolean', async () => {
        const volumeOf = async (id) => (await engine.call('checkMeshHealth', { objectId: id })).volume;
        const place = async (offset) => {
            await engine.call('addModel', { path: '/models/cube.obj' });
            const objects = (await engine.call('getObjectTree', {})).objects;
            const obj = objects[objects.length - 1];
            await engine.call('setInstanceTransform', { objectId: obj.id, instanceId: obj.instances[0].id, offset });
            return obj.id;
        };
        // Two 20 mm cubes, the second shifted by (10, 5) on the bed (objects always rest on it): they overlap in a 10 x 15 x 20 mm box (3000 mm3).
        for (const [mode, expected] of [['intersection', 3000], ['difference', 5000], ['union', 13000]]) {
            const target = await place([0, 0, 10]);
            const tool = await place([10, 5, 15]);
            const res = await engine.call('meshBoolean', { mode, targetObjectId: target, toolObjectIds: [tool] });
            assert.equal(res.success, true, mode + JSON.stringify(res));
            const got = await volumeOf(target);
            assert.ok(Math.abs(got - expected) < 1, `${mode} volume is ${expected}, got ${got}`);
            const ids = (await engine.call('getObjectTree', {})).objects.map((o) => o.id);
            assert.ok(!ids.includes(tool), 'the tool object is consumed unless keepTools is set');
            await engine.call('deleteObject', { objectId: target });
        }
    });

    await t.test('SVG Operations', async () => {
        const svgText = `<svg width="10" height="10"><rect width="10" height="10" /></svg>`;
        let res = await engine.call('addSvg', { svgText: svgText, depth: 5, useSurface: false });
        assert.ok(res.objectId !== undefined);
        
        let getRes = await engine.call('getSvg', { objectId: res.objectId, volumeId: res.volumeId });
        assert.equal(getRes.svgText, svgText);
        assert.equal(getRes.depth, 5);
        
        let health = await engine.call('checkMeshHealth', { objectId: res.objectId });
        assert.ok(health.volume > 0); 
        
        let updateRes = await engine.call('updateSvg', { objectId: res.objectId, volumeId: res.volumeId, depth: 10 });
        assert.ok(updateRes.objectId !== undefined);
        let health2 = await engine.call('checkMeshHealth', { objectId: res.objectId });
        assert.ok(health2.volume > health.volume);

        await engine.call('deleteObject', { objectId: res.objectId });
    });
    
    await t.test('BrimEars', async () => {
        let r1 = await engine.call('addModel', { path: '/models/cube.obj' });
        let objId = r1.objects[0].id;
        
        let setRes = await engine.call('setBrimEars', { objectId: objId, points: [
            {position: [10, 10, 0], radius: 5.0},
            {position: [-10, -10, 0], radius: 5.0}
        ]});
        assert.equal(setRes.success, true);
        
        let getRes = await engine.call('getBrimEars', { objectId: objId });
        assert.equal(getRes.points.length, 2);
        assert.equal(getRes.points[0].radius, 5.0);
        
        let clearRes = await engine.call('clearBrimEars', { objectId: objId });
        assert.equal(clearRes.success, true);
        
        getRes = await engine.call('getBrimEars', { objectId: objId });
        assert.equal(getRes.points.length, 0);

        await engine.call('deleteObject', { objectId: objId });
    });
});
