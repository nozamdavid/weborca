import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(repoRoot, 'wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs');
const bundleDir = path.join(repoRoot, 'wasm/build/tests-node');

test('text part grows a cube mesh and keeps editable metadata through 3MF', async () => {
  const bundles = ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json'];
  if (bundles.some((file) => !fs.existsSync(path.join(bundleDir, file)))) {
    execFileSync(process.execPath, [path.join(repoRoot, 'wasm/web/tools/pack_profiles.mjs'), repoRoot,
      bundleDir, 'Voron', 'OrcaFilamentLibrary'], { stdio: 'inherit' });
  }
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    for (const name of ['resources', 'OrcaFilamentLibrary', 'Voron']) {
      const file = name === 'resources' ? 'resources.json' : `profiles/${name}.json`;
      await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(bundleDir, file), 'utf8')));
    }
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
    await core.call('selectPresets', {
      printer: 'Voron 2.4 300 0.4 nozzle',
      process: '0.20mm Standard @Voron',
      filaments: ['Generic PLA @System']
    });

    core.writeFile('/fonts/DejaVuSans.ttf', fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf')));
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;
    const instanceOffset = before.objects[0].instances[0].offset;
    const meshBefore = await core.call('getMesh', { objectId });

    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'Orca',
      fontPath: '/fonts/DejaVuSans.ttf',
      fontName: 'DejaVu Sans',
      size: 6,
      depth: 1,
      position: [instanceOffset[0] + 10, instanceOffset[1] + 10, instanceOffset[2] + 20]
    });
    assert.equal(added.objectId, objectId);
    assert.ok(added.triangleCount > 0);
    const tree = await core.call('getObjectTree', {});
    assert.equal(tree.objects[0].volumes.length, 2);
    const meshAfter = await core.call('getMesh', { objectId });
    assert.ok(meshAfter.triangleCount > meshBefore.triangleCount);

    const info = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.equal(info.text, 'Orca');
    assert.equal(info.fontPath, '/fonts/DejaVuSans.ttf');

    const updated = await core.call('updateText', { objectId, volumeId: added.volumeId, text: 'Orca!' });
    assert.equal(updated.volumeId, added.volumeId);
    assert.ok(updated.triangleCount > 0);
    const edited = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.equal(edited.text, 'Orca!');

    await core.call('saveProject', { path: '/out/text_roundtrip.3mf' });
    await core.call('openProject', { path: '/out/text_roundtrip.3mf' });
    const reopened = await core.call('getObjectTree', {});
    const reopenedObject = reopened.objects[0];
    assert.equal(reopenedObject.volumes.length, 2);
    const textVolume = reopenedObject.volumes.find((volume) => volume.name === 'Orca!');
    assert.ok(textVolume);
    const restored = await core.call('getText', { objectId: reopenedObject.id, volumeId: textVolume.id });
    assert.equal(restored.text, 'Orca!');
    assert.equal(restored.fontName, 'DejaVu Sans');
    assert.equal(restored.size, 6);
    assert.equal(restored.depth, 1);
  } finally {
    core.dispose();
  }
});
