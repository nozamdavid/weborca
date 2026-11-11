import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createEngineCore } from '../../web/engine-core.js';

// A dense flat surface keeps containment projection active long enough to observe
// its real progress notification. It is removed before the recovery slice.
const divisions = 400;
const bytes = new Uint8Array(84 + divisions * divisions * 2 * 50);
const view = new DataView(bytes.buffer);
view.setUint32(80, divisions * divisions * 2, true);
let cursor = 84;
for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
  const a = [x / divisions * 20, y / divisions * 20, 10];
  const b = [(x + 1) / divisions * 20, a[1], 10];
  const c = [a[0], (y + 1) / divisions * 20, 10];
  const d = [b[0], c[1], 10];
  for (const triangle of [[a,b,c],[b,d,c]]) {
    for (let i = 0; i < 3; i++) for (let axis = 0; axis < 3; axis++)
      view.setFloat32(cursor + 12 + i * 12 + axis * 4, triangle[i][axis], true);
    cursor += 50;
  }
}
const runtime = await import(path.resolve(process.env.ORCA_ENGINE_MODULE || 'wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs'));
const core = await createEngineCore({ moduleFactory: runtime.default || runtime.createOrcaEngine, threads:2 });
try {
  for (const file of ['resources.json','profiles/OrcaFilamentLibrary.json','profiles/Voron.json'])
    await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join('wasm/build/web',file))));
  await core.call('init',{resourcesDir:'/resources',dataDir:'/data'});
  await core.call('loadVendors');
  await core.call('selectPresets',{printer:'Voron 2.4 300 0.4 nozzle',process:'0.20mm Standard @Voron',filaments:['Generic PLA @System']});
  core.writeFile('/models/cube.obj',fs.readFileSync('tests/data/20mm_cube.obj'));
  await core.call('addModel',{path:'/models/cube.obj'});
  core.writeFile('/models/preflight.stl',bytes);
  await core.call('addModel',{path:'/models/preflight.stl'});
  const objects = await core.call('listObjects');
  for (const object of objects) for (const instance of object.instances)
    await core.call('setInstanceTransform',{objectId:object.id,instanceId:instance.id,offset:[80,80,0]});
  const before = await core.call('listObjects');
  const controller = new AbortController();
  let observed = false, abortAt = 0;
  await assert.rejects(core.call('slice',{outPath:'/out/preflight-canceled.gcode',threads:2,plateIndex:0},{
    signal:controller.signal,
    onProgress(progress) {
      if (progress.text === 'Checking bed boundaries' && !observed) {
        observed = true;
        abortAt = performance.now();
        controller.abort();
      }
    }
  }), error => error.name === 'AbortError');
  assert.ok(observed,'cancel must occur during running containment, not before native job starts');
  const elapsedMs = performance.now() - abortAt;
  assert.deepEqual(await core.call('listObjects'),before,'cancellation restores model state');
  await core.call('deleteObject',{objectId:objects[1].id});
  await core.call('slice',{outPath:'/out/recovered.gcode',threads:2,plateIndex:0});
  assert.match(new TextDecoder().decode(core.readFile('/out/recovered.gcode')),/; printing object /);
  console.log(JSON.stringify({preflightCanceled:true,triangles:divisions*divisions*2,elapsedMs,recovery:true}));
} finally { core.dispose(); }
