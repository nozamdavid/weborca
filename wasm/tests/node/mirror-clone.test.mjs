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


/** A wedge: 20 mm square footprint, tapering from 20 mm high at x=0 to 0 at x=20 (not mirror-symmetric). */
const WEDGE = `v 0 0 0
v 20 0 0
v 20 20 0
v 0 20 0
v 0 0 20
v 0 20 20
f 1 3 2
f 1 4 3
f 1 2 5
f 4 6 3
f 1 5 6
f 1 6 4
f 2 3 6
f 2 6 5
f 3 6 4
`;

const usedFilament = (gcode) => parseFloat(new TextDecoder().decode(gcode).match(/filament used \[mm\]\s*=\s*([0-9.]+)/)?.[1] ?? '0');

describe('Orca WASM engine: mirror, clone and arrange', () => {
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

    // Write test cube into MEMFS
    const cubeBytes = fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj'));
    core.writeFile('/models/cube.obj', cubeBytes);
    core.writeFile('/models/wedge.obj', new TextEncoder().encode(WEDGE));
  });

  after(() => {
    if (core) {
      core.dispose();
    }
  });


  const only = async () => (await core.call('listObjects', {}))[0];

  const handed = (instance) => instance.mirror[0] * instance.mirror[1] * instance.mirror[2];

  test('mirrorInstance reflects the instance, keeps size and bed contact, and a second call restores it', async () => {
    await core.call('addModel', { path: '/models/wedge.obj' });
    const added = await only();
    // An imported model is centred on the origin; setting its transform drops it onto the bed.
    await core.call('setInstanceTransform', { objectId: added.id, instanceId: added.instances[0].id, offset: [0, 0, 0] });
    const before = await only();
    assert.equal(handed(before.instances[0]), 1);
    const ids = { objectId: before.id, instanceId: before.instances[0].id };

    for (const axis of [0, 1, 2]) {
      await core.call('mirrorInstance', { ...ids, axis });
      const mirrored = await only();
      assert.equal(handed(mirrored.instances[0]), -1, `axis ${axis} makes it left-handed`);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(mirrored.size[i] - before.size[i]) < 1e-6, 'the size is unchanged');
      assert.ok(Math.abs(mirrored.instances[0].offset[2] - before.instances[0].offset[2]) < 1e-6, `still on the bed: axis ${axis} ${JSON.stringify(before.instances[0])} vs ${JSON.stringify(mirrored.instances[0])}`);
      assert.ok(mirrored.instances[0].scale.every((v) => v > 0), 'the scale stays positive');
      await core.call('mirrorInstance', { ...ids, axis });
      assert.equal(handed((await only()).instances[0]), 1, `axis ${axis} twice is a no-op`);
    }
  });

  test('a mirror survives a later scale change and slices to the same volume', async () => {
    const obj = await only();
    const ids = { objectId: obj.id, instanceId: obj.instances[0].id };
    await core.call('slice', { outPath: '/out/plain.gcode', threads: 4 });
    const plain = usedFilament(core.readFile('/out/plain.gcode'));
    assert.ok(plain > 0);

    await core.call('mirrorInstance', { ...ids, axis: 0 });
    const now = await only();
    await core.call('setInstanceTransform', { ...ids, rotation: now.instances[0].rotation, scale: [1, 1, 1] });
    assert.equal(handed((await only()).instances[0]), -1, `setting the scale keeps the mirror: before ${JSON.stringify(now.instances[0])} after ${JSON.stringify((await only()).instances[0])}`);
    await core.call('slice', { outPath: '/out/mirrored.gcode', threads: 4 });
    const mirrored = usedFilament(core.readFile('/out/mirrored.gcode'));
    assert.ok(Math.abs(mirrored - plain) / plain < 0.02, `mirrored ${mirrored} vs plain ${plain}`);
    await core.call('mirrorInstance', { ...ids, axis: 0 });
  });

  test('cloneObject makes an independent copy with the same size and a new id', async () => {
    const before = await core.call('listObjects', {});
    const source = before[0];
    const res = await core.call('cloneObject', { objectId: source.id });
    assert.ok(res.objectId > 0 && res.objectId !== source.id);
    const after = await core.call('listObjects', {});
    assert.equal(after.length, before.length + 1);
    const copy = after.find((o) => o.id === res.objectId);
    assert.deepEqual(copy.size.map((v) => Math.round(v * 1000)), source.size.map((v) => Math.round(v * 1000)));
    assert.deepEqual(copy.instances[0].mirror, source.instances[0].mirror, 'the mirror is copied');

    await core.call('setInstanceTransform', { objectId: copy.id, instanceId: copy.instances[0].id, offset: [100, 100, 0] });
    const moved = (await core.call('listObjects', {})).find((o) => o.id === source.id);
    assert.deepEqual(moved.instances[0].offset, source.instances[0].offset, 'the original did not move');
    await assert.rejects(core.call('cloneObject', { objectId: 999999 }), /not found/i);
  });

  test('arrange honours the requested spacing', async () => {
    const gap = async (spacing) => {
      await core.call('arrange', { useBed: true, spacing, allowRotations: false });
      const [a, b] = await core.call('listObjects', {});
      const dx = Math.abs(a.instances[0].offset[0] - b.instances[0].offset[0]);
      const dy = Math.abs(a.instances[0].offset[1] - b.instances[0].offset[1]);
      return Math.max(dx - a.size[0], dy - a.size[1]);
    };
    const tight = await gap(1);
    const wide = await gap(40);
    assert.ok(wide > tight + 20, `a 40 mm spacing leaves a larger gap (${wide}) than 1 mm (${tight})`);
    assert.ok(wide >= 39, `the gap is at least the requested spacing (${wide})`);
  });
});
