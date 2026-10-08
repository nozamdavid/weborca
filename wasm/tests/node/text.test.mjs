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

test('valid base64 fontData containing slashes adds text volume without host fallback', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;

    // Load actual bundled font and encode as base64 (contains thousands of slashes '/')
    const fontBytes = fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf'));
    const base64Data = fontBytes.toString('base64');
    assert.ok(base64Data.includes('/'), 'Base64 font data must contain slashes');

    // Add text using fontData directly without having /fonts/DejaVuSans.ttf written
    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'B64Slash',
      fontData: base64Data,
      fontName: 'Custom B64 Font',
      size: 5,
      depth: 1
    });
    assert.equal(added.objectId, objectId);
    assert.ok(added.triangleCount > 0);

    const info = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.equal(info.text, 'B64Slash');
    assert.equal(info.fontName, 'Custom B64 Font');
  } finally {
    core.dispose();
  }
});

test('invalid custom fontData throws without silent fallback', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;

    // Invalid base64 font data should throw, not silently fall back to default
    await assert.rejects(
      async () => {
        await core.call('addText', {
          objectId,
          volumeType: 'part',
          text: 'CorruptFont',
          fontData: 'dGhpcyBpcyBub3QgYSBmb250IGZpbGUh', // "this is not a font file!"
          fontName: 'Corrupt',
          size: 5,
          depth: 1
        });
      },
      /Failed to parse.*font|runtime_error/i
    );
  } finally {
    core.dispose();
  }
});

test('rotation-only update preserves surface normal tilt without flattening to XY bed plane', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/fonts/DejaVuSans.ttf', fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf')));
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;
    const instanceOffset = before.objects[0].instances[0].offset;

    // Emboss text on the vertical side face of the cube with normal [0, 1, 0] (tilted 90 deg from bed Z)
    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'SideTilt',
      fontPath: '/fonts/DejaVuSans.ttf',
      fontName: 'DejaVu Sans',
      size: 5,
      depth: 1,
      position: [instanceOffset[0] + 10, instanceOffset[1] + 20, instanceOffset[2] + 10],
      normal: [0, 1, 0],
      rotation: 0
    });
    assert.equal(added.objectId, objectId);
    const bbBefore = added.boundingBox; // [minX, minY, minZ, maxX, maxY, maxZ]

    // On vertical face (normal [0, 1, 0]), depth is along Y axis: Y span is small (~1mm)
    const ySpanBefore = bbBefore[4] - bbBefore[1];
    const zSpanBefore = bbBefore[5] - bbBefore[2];
    assert.ok(ySpanBefore < 3.0, `Y span before rotation should be shallow depth ~1mm, got ${ySpanBefore}`);
    assert.ok(zSpanBefore > 3.0, `Z span before rotation should reflect font height, got ${zSpanBefore}`);

    // Update with rotation only (no position, no normal)
    const updated = await core.call('updateText', {
      objectId,
      volumeId: added.volumeId,
      rotation: 45
    });
    assert.equal(updated.volumeId, added.volumeId);
    const bbAfter = updated.boundingBox;

    // Verify tilt is preserved: Y span remains shallow (~1-2mm depth) and Z spans across face
    // If flattened to XY bed plane, normal would point along Z, making Z span ~1mm and Y span large
    const ySpanAfter = bbAfter[4] - bbAfter[1];
    const zSpanAfter = bbAfter[5] - bbAfter[2];
    assert.ok(ySpanAfter < 4.0, `Y span after rotation must stay along surface normal (<4mm), got ${ySpanAfter}`);
    assert.ok(zSpanAfter > 3.0, `Z span after rotation must reflect angled text (>3mm), got ${zSpanAfter}`);
  } finally {
    core.dispose();
  }
});

test('corrupt update leaves existing geometry intact', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/fonts/DejaVuSans.ttf', fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf')));
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;

    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'Intact',
      fontPath: '/fonts/DejaVuSans.ttf',
      fontName: 'DejaVu Sans',
      size: 6,
      depth: 1
    });
    const meshBefore = await core.call('getMesh', { objectId });
    const infoBefore = await core.call('getText', { objectId, volumeId: added.volumeId });

    // Attempt invalid update with corrupt fontData
    await assert.rejects(
      async () => {
        await core.call('updateText', {
          objectId,
          volumeId: added.volumeId,
          text: 'CorruptedAttempt',
          fontData: 'aW52YWxpZC1mb250LWRhdGE=' // "invalid-font-data"
        });
      },
      /Failed to parse.*font|runtime_error/i
    );

    // Verify existing geometry is completely preserved
    const meshAfter = await core.call('getMesh', { objectId });
    assert.equal(meshAfter.triangleCount, meshBefore.triangleCount);

    const infoAfter = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.equal(infoAfter.text, 'Intact');
    assert.equal(infoAfter.fontName, infoBefore.fontName);
  } finally {
    core.dispose();
  }
});

test('base64 fontData with data-URI prefix and padding decodes cleanly without UB', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;

    const fontBytes = fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf'));
    const base64Data = 'data:font/truetype;base64,' + fontBytes.toString('base64');

    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'DataUriB64',
      fontData: base64Data,
      fontName: 'DataURI Font',
      size: 5,
      depth: 1
    });
    assert.equal(added.objectId, objectId);
    assert.ok(added.triangleCount > 0);

    const info = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.equal(info.text, 'DataUriB64');
  } finally {
    core.dispose();
  }
});

test('small rotation angles in degrees preserve orientation and remain idempotent without drift', async () => {
  const mod = await import(modulePath);
  const core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 4 });
  try {
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    core.writeFile('/fonts/DejaVuSans.ttf', fs.readFileSync(path.join(repoRoot, 'wasm/app/public/fonts/DejaVuSans.ttf')));
    core.writeFile('/models/cube.obj', fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj')));
    await core.call('loadModel', { path: '/models/cube.obj' });
    const before = await core.call('getObjectTree', {});
    const objectId = before.objects[0].id;
    const instanceOffset = before.objects[0].instances[0].offset;

    // Test addText with small positive angle (5 degrees)
    const added = await core.call('addText', {
      objectId,
      volumeType: 'part',
      text: 'Angle5',
      fontPath: '/fonts/DejaVuSans.ttf',
      fontName: 'DejaVu Sans',
      size: 5,
      depth: 1,
      position: [instanceOffset[0] + 10, instanceOffset[1] + 10, instanceOffset[2] + 20],
      normal: [0, 0, 1],
      rotation: 5
    });
    assert.equal(added.objectId, objectId);

    // Read back: rotation must be ~5 degrees, NOT ~286.5 degrees (5 radians)
    const info5 = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.ok(Math.abs(info5.rotation - 5.0) < 0.1, `Expected rotation near 5 deg, got ${info5.rotation}`);

    // Update with 1 degree: rotation must be ~1 degree, NOT ~57.3 degrees (1 radian)
    await core.call('updateText', {
      objectId,
      volumeId: added.volumeId,
      rotation: 1
    });
    const info1 = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.ok(Math.abs(info1.rotation - 1.0) < 0.1, `Expected rotation near 1 deg, got ${info1.rotation}`);

    // Update with small negative angle (-5 degrees): rotation must be ~-5 degrees, NOT radians
    const updatedNeg = await core.call('updateText', {
      objectId,
      volumeId: added.volumeId,
      rotation: -5
    });
    const infoNeg = await core.call('getText', { objectId, volumeId: added.volumeId });
    assert.ok(Math.abs(infoNeg.rotation - (-5.0)) < 0.1, `Expected rotation near -5 deg, got ${infoNeg.rotation}`);

    // Repeated readback and update: verify idempotency and zero geometry orientation drift
    const bbInitial = updatedNeg.boundingBox;
    for (let i = 0; i < 4; i++) {
      const cur = await core.call('getText', { objectId, volumeId: added.volumeId });
      const reUpdated = await core.call('updateText', {
        objectId,
        volumeId: added.volumeId,
        rotation: cur.rotation
      });
      const curAfter = await core.call('getText', { objectId, volumeId: added.volumeId });
      assert.ok(Math.abs(curAfter.rotation - cur.rotation) < 0.01, `Drift detected in rotation at step ${i}`);
      for (let b = 0; b < 6; b++) {
        assert.ok(Math.abs(reUpdated.boundingBox[b] - bbInitial[b]) < 1e-3, `Bounding box drift at index ${b} step ${i}`);
      }
    }
  } finally {
    core.dispose();
  }
});
