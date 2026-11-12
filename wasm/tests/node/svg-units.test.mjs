import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createEngineCore } from '../../web/engine-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modulePath = path.resolve(process.env.ORCA_ENGINE_MODULE ||
  path.join(root, 'wasm/build/orca-step-runtime/wasm/engine/orca_engine.mjs'));

async function setupSvgCore(core) {
  for (const name of ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json']) {
    const bundle = path.join(root, 'wasm/build/tests-node', name);
    await core.addVendorBundle(JSON.parse(fs.readFileSync(bundle, 'utf8')));
  }
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  await core.call('loadVendors', {});
  await core.call('selectPresets', { printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron', filaments: ['Generic PLA @System'] });
  await core.call('setOptions', { options: { enable_prime_tower: '0', enable_support: '0',
    layer_height: '0.2', initial_layer_print_height: '0.2' } });
}

function archiveEntries(bytes) {
  return JSON.parse(execFileSync('python3', ['-c', `
import io, json, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    print(json.dumps(archive.namelist()))
`], { input: bytes, encoding: 'utf8' }));
}

test('SVG shapes keep physical dimensions and extrusion depth when edited and reopened', async () => {
  const imported = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: imported.createOrcaEngine || imported.default, threads: 2 });
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001,
    `expected ${expected} mm, got ${actual} mm`);
  const dimensions = async id => (await core.call('listObjects', {})).find(object => object.id === id).size;
  try {
    await setupSvgCore(core);

    const pixels = await core.call('addSvg', {
      svgText: '<svg width="10" height="20"><rect width="10" height="20" /></svg>', depth: 1.5
    });
    let size = await dimensions(pixels.objectId);
    near(size[0], 10 * 25.4 / 96);
    near(size[1], 20 * 25.4 / 96);
    near(size[2], 1.5);
    await core.call('deleteObject', { objectId: pixels.objectId });

    const millimeters = '<svg width="10mm" height="5mm" viewBox="0 0 100 50"><rect width="100" height="50" /></svg>';
    const shape = await core.call('addSvg', { svgText: millimeters, depth: 1, name: 'Physical SVG' });
    size = await dimensions(shape.objectId);
    [10, 5, 1].forEach((expected, axis) => near(size[axis], expected));
    await core.call('updateSvg', { objectId: shape.objectId, volumeId: shape.volumeId, depth: 2 });
    size = await dimensions(shape.objectId);
    [10, 5, 2].forEach((expected, axis) => near(size[axis], expected));

    await core.call('saveProject', { path: '/out/physical-svg.3mf', compressionLevel: 2 });
    await core.call('openProject', { path: '/out/physical-svg.3mf' });
    const object = (await core.call('getObjectTree', {})).objects.find(item => item.name === 'Physical SVG');
    size = await dimensions(object.id);
    [10, 5, 2].forEach((expected, axis) => near(size[axis], expected));
    const metadata = await core.call('getSvg', { objectId: object.id, volumeId: object.volumes[0].id });
    assert.equal(metadata.svgText, millimeters);
    assert.equal(metadata.depth, 2);
    // Keep the reopened object inside the 300 mm Voron bed before slicing.
    await core.call('setInstanceTransform', { objectId: object.id, instanceId: (await core.call('listObjects', {})).find(item => item.id === object.id).instances[0].id, offset: [150, 150, 0] });
    const sliced = await core.call('slice', { outPath: '/out/physical-svg.gcode', threads: 2 });
    assert.ok(sliced.layers > 0 && sliced.layers < 20, 'a 2 mm extrusion produces a small, finite print');
    assert.ok(sliced.gcodeBytes > 0 && sliced.gcodeBytes < 1024 * 1024);
  } finally {
    core.dispose();
  }
});

test('Cloned SVG shapes share one archive source and keep independent edits', async () => {
  const imported = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: imported.createOrcaEngine || imported.default, threads: 2 });
  const svgText = '<svg width="10mm" height="5mm" viewBox="0 0 100 50"><rect width="100" height="50" /></svg>';
  const editedText = '<svg width="8mm" height="6mm" viewBox="0 0 80 60"><rect width="80" height="60" /></svg>';
  const saveAndReopen = async sourceCount => {
    await core.call('saveProject', { path: '/out/cloned-svg.3mf', compressionLevel: 2 });
    const entries = archiveEntries(core.readFile('/out/cloned-svg.3mf'));
    assert.equal(entries.length, new Set(entries).size, 'each ZIP part has a unique path');
    assert.equal(entries.filter(name => name.endsWith('.svg')).length, sourceCount);
    await core.call('openProject', { path: '/out/cloned-svg.3mf' });
    return (await core.call('getObjectTree', {})).objects;
  };
  const checkShape = async (object, text, size, wallLoops) => {
    assert.ok(object);
    assert.equal(object.config.wall_loops, wallLoops);
    const shape = await core.call('getSvg', { objectId: object.id, volumeId: object.volumes[0].id });
    assert.equal(shape.svgText, text);
    assert.equal(shape.depth, size[2]);
    const saved = (await core.call('listObjects', {})).find(item => item.id === object.id);
    size.forEach((value, axis) => assert.ok(Math.abs(saved.size[axis] - value) < 0.001));
  };
  try {
    await setupSvgCore(core);
    const source = await core.call('addSvg', { svgText, depth: 2, name: 'Original SVG' });
    await core.call('setObjectConfig', { objectId: source.objectId, options: { wall_loops: '4' } });
    const clone = await core.call('cloneObject', { objectId: source.objectId });
    await core.call('renameObject', { objectId: clone.objectId, name: 'Cloned SVG' });
    await core.call('setObjectConfig', { objectId: clone.objectId, options: { wall_loops: '6' } });
    let objects = await saveAndReopen(1);
    assert.equal(objects.length, 2);
    let original = objects.find(object => object.name === 'Original SVG');
    let copied = objects.find(object => object.name === 'Cloned SVG');
    await checkShape(original, svgText, [10, 5, 2], '4');
    await checkShape(copied, svgText, [10, 5, 2], '6');

    await core.call('updateSvg', { objectId: copied.id, volumeId: copied.volumes[0].id, svgText: editedText, depth: 3 });
    objects = await saveAndReopen(2);
    assert.equal(objects.length, 2);
    original = objects.find(object => object.name === 'Original SVG');
    copied = objects.find(object => object.name === 'Cloned SVG');
    await checkShape(original, svgText, [10, 5, 2], '4');
    await checkShape(copied, editedText, [8, 6, 3], '6');
  } finally {
    core.dispose();
  }
});

test('Imported SVG part names cannot alias another volume when its source is edited', async () => {
  const imported = await import(modulePath);
  const factory = imported.createOrcaEngine || imported.default;
  const createCore = async () => {
    const core = await createEngineCore({ moduleFactory: factory, threads: 2 });
    await setupSvgCore(core);
    return core;
  };
  const originalText = '<svg width="10mm" height="5mm" viewBox="0 0 100 50"><rect width="100" height="50" /></svg>';
  const otherText = '<svg width="6mm" height="4mm" viewBox="0 0 60 40"><rect width="60" height="40" /></svg>';
  const editedText = '<svg width="8mm" height="6mm" viewBox="0 0 80 60"><rect width="80" height="60" /></svg>';
  let project, targetId;
  let core = await createCore();
  try {
    await core.call('addSvg', { svgText: originalText, depth: 1, name: 'Imported original' });
    await core.call('addSvg', { svgText: otherText, depth: 2, name: 'Edited other' });
    await core.call('saveProject', { path: '/out/input.3mf' });
    project = core.readFile('/out/input.3mf');
  } finally {
    core.dispose();
  }
  // Imported part names are arbitrary; determine the target's fresh-runtime ID,
  // then construct a valid project whose other SVG already owns that spelling.
  core = await createCore();
  try {
    core.writeFile('/out/input.3mf', project);
    await core.call('openProject', { path: '/out/input.3mf' });
    targetId = (await core.call('getObjectTree', {})).objects
      .find(object => object.name === 'Edited other').volumes[0].id;
  } finally {
    core.dispose();
  }
  const collisionPath = `3D/svg_${targetId}.svg`;
  const patchedProject = execFileSync('python3', ['-c', `
import io, sys, zipfile
source = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
svg_names = [entry.filename for entry in source.infolist() if entry.filename.endswith('.svg')]
assert len(svg_names) == 2
rename = {svg_names[0]: sys.argv[1], svg_names[1]: '3D/imported_other.svg'}
output = io.BytesIO()
with zipfile.ZipFile(output, 'w') as archive:
    for entry in source.infolist():
        data = source.read(entry)
        if entry.filename.endswith(('.xml', '.config', '.model')):
            for old, new in rename.items():
                data = data.replace(old.encode(), new.encode())
        archive.writestr(rename.get(entry.filename, entry.filename), data, compress_type=entry.compress_type)
sys.stdout.buffer.write(output.getvalue())
`, collisionPath], { input: project });
  core = await createCore();
  try {
    core.writeFile('/out/input.3mf', patchedProject);
    await core.call('openProject', { path: '/out/input.3mf' });
    let objects = (await core.call('getObjectTree', {})).objects;
    const edited = objects.find(object => object.name === 'Edited other');
    assert.equal(edited.volumes[0].id, targetId, 'the fresh-runtime collision is exercised');
    await core.call('updateSvg', { objectId: edited.id, volumeId: targetId, svgText: editedText, depth: 3 });
    await core.call('saveProject', { path: '/out/output.3mf', compressionLevel: 2 });
    const entries = archiveEntries(core.readFile('/out/output.3mf'));
    assert.equal(entries.length, new Set(entries).size);
    assert.equal(entries.filter(name => name.endsWith('.svg')).length, 2);
    await core.call('openProject', { path: '/out/output.3mf' });
    objects = (await core.call('getObjectTree', {})).objects;
    for (const [name, text, depth] of [['Imported original', originalText, 1], ['Edited other', editedText, 3]]) {
      const object = objects.find(object => object.name === name);
      const svg = await core.call('getSvg', { objectId: object.id, volumeId: object.volumes[0].id });
      assert.equal(svg.svgText, text, `${name} retains its independent source after reopening`);
      assert.equal(svg.depth, depth);
      const size = (await core.call('listObjects', {})).find(item => item.id === object.id).size;
      const expected = name === 'Imported original' ? [10, 5, 1] : [8, 6, 3];
      expected.forEach((value, axis) => assert.ok(Math.abs(size[axis] - value) < 0.001));
    }
  } finally {
    core.dispose();
  }
});
