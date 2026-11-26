import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../../app/node_modules/fflate/esm/browser.js';
import { createEngineCore } from '../../web/engine-core.js';
const root = process.cwd();
const objectLabels = bytes => [...new Set(new TextDecoder().decode(bytes).split('\n').filter(l => l.startsWith('; printing object ')))];
const mod = await import(path.resolve(process.env.ORCA_ENGINE_MODULE || 'wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs'));
const core = await createEngineCore({ moduleFactory: mod.default || mod.createOrcaEngine, threads: 2 });
try {
  for (const file of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json'])
    await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(root, 'wasm/build/web', file))));
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle', process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
  await core.call('setOptions', { options: { printable_area: '0x0,100x0,100x100,0x100', enable_prime_tower: '0', skirt_loops: '0' } });
  core.writeFile('/models/cube.obj', fs.readFileSync('tests/data/20mm_cube.obj'));
  await core.call('addModel', { path: '/models/cube.obj' });
  const [obj] = await core.call('listObjects', {});
  const inst = obj.instances[0].id;
  const move = (id, x, y, extra = {}) => core.call('setInstanceTransform', { objectId: obj.id, instanceId: id, offset: [x,y,0], ...extra });
  await move(inst, 40, 40);
  const baseline = await core.call('slice', { outPath: '/out/base.gcode', threads: 2, plateIndex: 0 });
  assert.ok(baseline);
  const baselineLabels = [...new Set(new TextDecoder().decode(core.readFile('/out/base.gcode')).split('\n').filter(l => l.startsWith('; printing object ')))];
  const copy = await core.call('duplicateInstance', { objectId: obj.id, instanceId: inst });
  await move(copy.instanceId, 150, 40);
  await core.call('slice', { outPath: '/out/mixed.gcode', threads: 2, plateIndex: 0 });
  const text = new TextDecoder().decode(core.readFile('/out/mixed.gcode'));
  // Object labels identify the actual emitted copies, independently of start/end G-code travel.
  assert.equal((text.match(/; printing object /g) || []).length > 0, true);
  assert.ok(!text.includes('copy 1'), 'outside copy must not appear in emitted object labels');
  console.log('PASS outside copy excluded');
  for (const [name, x, y, extra] of [
    ['crossing edge', 95, 40, {}],
    ['rotated scaled mirrored', 95, 40, { rotation: [0,0,0.7], scale: [2,1,1] }],
  ]) {
    if (name.includes('mirrored')) await core.call('mirrorInstance', { objectId: obj.id, instanceId: copy.instanceId, axis: 0 });
    await move(copy.instanceId, x, y, extra);
    await core.call('slice', { outPath: '/out/check.gcode', threads: 2, plateIndex: 0 });
    assert.equal(objectLabels(core.readFile('/out/check.gcode')).length, 1, name);
    console.log('PASS', name);
  }
  await move(copy.instanceId, 70, 70);
  await core.call('slice', { outPath: '/out/transformed-inside.gcode', threads: 2, plateIndex: 0 });
  assert.equal(objectLabels(core.readFile('/out/transformed-inside.gcode')).length, 2, 'inside transformed mirrored copy still slices');
  console.log('PASS inside transformed mirrored copy retained');
  // The copy's double-precision extent is inside, but the scaled float
  // transform rounds its right edge from 300000017 to 300000032.
  await core.call('setOptions', { options: { printable_area: '0x0,300.000018x0,300.000018x100,0x100' } });
  await move(copy.instanceId, 290.000017, 40, { rotation: [0,0,0], scale: [1,1,1] });
  await core.call('slice', { outPath: '/out/float-edge.gcode', threads: 2, plateIndex: 0 });
  assert.equal(objectLabels(core.readFile('/out/float-edge.gcode')).length, 1, 'scaled float footprint crosses the bed edge');
  console.log('PASS exact projection at float-rounded edge');
  await core.call('setOptions', { options: { printable_area: '0x50,50x0,100x50,50x100' } });
  await move(inst, 50, 50);
  await move(copy.instanceId, 85, 85, { rotation: [0,0,0], scale: [1,1,1] });
  await core.call('slice', { outPath: '/out/diamond.gcode', threads: 2, plateIndex: 0 });
  assert.equal(objectLabels(core.readFile('/out/diamond.gcode')).length, 1, 'actual polygon excludes corner');
  console.log('PASS actual nonrectangular polygon');
  for (const [name, polygon, inside, outside] of [
    ['concave notch', '0x0,100x0,100x100,60x100,60x40,40x40,40x100,0x100', [20,20], [50,60]],
    ['circular bed', Array.from({length:64}, (_,i) => `${50+50*Math.cos(i*Math.PI/32)}x${50+50*Math.sin(i*Math.PI/32)}`).join(','), [50,50], [85,85]],
  ]) {
    await core.call('setOptions', { options: { printable_area: polygon } });
    await move(inst, ...inside);
    await move(copy.instanceId, ...outside);
    await core.call('slice', { outPath: '/out/polygon.gcode', threads: 2, plateIndex: 0 });
    assert.equal(objectLabels(core.readFile('/out/polygon.gcode')).length, 1, name);
    console.log('PASS', name);
  }
  await core.call('setOptions', { options: { printable_area: '20x20,120x20,120x120,20x120' } });
  await move(inst, 50, 50);
  await move(copy.instanceId, 15, 50);
  await core.call('slice', { outPath: '/out/origin.gcode', threads: 2 });
  assert.equal(objectLabels(core.readFile('/out/origin.gcode')).length, 1, 'nonzero bed origin');
  console.log('PASS nonzero polygon origin without plateIndex');
  await core.call('setOptions', { options: { printable_area: '0x0,100x0,100x100,0x100' } });
  await move(inst, 160, 40);
  await move(copy.instanceId, 270, 40);
  await core.call('slice', { outPath: '/out/second.gcode', threads: 2, plateIndex: 1 });
  assert.equal(objectLabels(core.readFile('/out/second.gcode')).length, 1, 'second plate origin');
  console.log('PASS second plate origin');
  await move(inst, 150, 40);
  await assert.rejects(core.call('slice', { outPath: '/out/empty.gcode', threads: 2 }), /[Nn]o.*[op]|[Ee]mpty|[Pp]rint validation/);
  await assert.rejects(core.call('slice', { outPath: '/out/mixed.gcode', threads: 2, plateIndex: 0 }), /The print is empty/);
  console.log('PASS all outside errors without plateIndex');
  await move(inst, 40, 40);
  await core.call('slice', { outPath: '/out/restored.gcode', threads: 2, plateIndex: 0 });
  assert.ok(new TextDecoder().decode(core.readFile('/out/restored.gcode')).includes('; printing object '), 'flags restored after failed slice');
  console.log('PASS flags restored after failure and other plate');
  const separate = await core.call('cloneObject', { objectId: obj.id });
  const separateObj = (await core.call('listObjects', {})).find(o => o.id === separate.objectId);
  for (const instance of separateObj.instances)
    await core.call('setInstanceTransform', { objectId: separateObj.id, instanceId: instance.id, offset: [180,40,0] });
  await core.call('slice', { outPath: '/out/separate.gcode', threads: 2, plateIndex: 0 });
  const labels = new TextDecoder().decode(core.readFile('/out/separate.gcode')).split('\n').filter(l => l.startsWith('; printing object '));
  assert.deepEqual([...new Set(labels)], baselineLabels, 'only inside object/instance emits G-code');
  await core.call('deleteObject', { objectId: separateObj.id });
  console.log('PASS separate outside object excluded');
  const controller = new AbortController();
  const canceled = core.call('slice', { outPath: '/out/canceled.gcode', threads: 2, plateIndex: 0 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(canceled, /canceled/);
  await core.call('slice', { outPath: '/out/after-cancel.gcode', threads: 2, plateIndex: 0 });
  assert.equal(objectLabels(core.readFile('/out/after-cancel.gcode')).length, 1);
  console.log('PASS queued cancellation restores flags');
  // Persist an explicitly nonprintable inside copy using the native 3MF contract.
  await move(copy.instanceId, 65, 40);
  await core.call('saveProject', { path: '/out/states.3mf' });
  const archive = unzipSync(core.readFile('/out/states.3mf'));
  const model = '3D/3dmodel.model';
  let items = 0;
  archive[model] = strToU8(strFromU8(archive[model]).replace(/<item\b[^>]*>/g, item => ++items === 2 ? item.replace(/printable="1"/, 'printable="0"') : item));
  assert.equal(items, 2);
  core.writeFile('/models/states.3mf', zipSync(archive));
  await core.call('openProject', { path: '/models/states.3mf' });
  await core.call('slice', { outPath: '/out/nonprintable.gcode', threads: 2, plateIndex: 0 });
  assert.ok(!new TextDecoder().decode(core.readFile('/out/nonprintable.gcode')).includes('copy 1'));
  await core.call('saveProject', { path: '/out/restored.3mf' });
  const restored = strFromU8(unzipSync(core.readFile('/out/restored.3mf'))[model]);
  assert.equal((restored.match(/printable="0"/g) || []).length, 1);
  assert.equal((restored.match(/printable="1"/g) || []).length, 1);
  console.log('PASS explicit nonprintable excluded and serialized flags restored');
} finally { core.dispose(); }
