import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngineCore } from '../../web/engine-core.js';
import { buildFeatureProject, readProjectState } from '../lib/project-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const modulePath = process.env.ORCA_ENGINE_MODULE
  ? path.resolve(process.env.ORCA_ENGINE_MODULE)
  : path.join(repoRoot, 'wasm', 'build', 'orca-wasm64', 'wasm', 'engine', 'orca_engine.mjs');
const bundleDir = path.join(repoRoot, 'wasm', 'build', 'tests-node');

describe('Project save and open round trip', () => {
  let core;

  before(async () => {
    const bundles = ['resources.json', 'profiles/OrcaFilamentLibrary.json', 'profiles/Voron.json'];
    if (bundles.some((b) => !fs.existsSync(path.join(bundleDir, b)))) {
      execFileSync(process.execPath, [path.join(repoRoot, 'wasm', 'web', 'tools', 'pack_profiles.mjs'), repoRoot, bundleDir, 'Voron', 'OrcaFilamentLibrary'], { stdio: 'inherit' });
    }
    const mod = await import(modulePath);
    core = await createEngineCore({ moduleFactory: mod.createOrcaEngine || mod.default, threads: 2 });
    for (const b of bundles) await core.addVendorBundle(JSON.parse(fs.readFileSync(path.join(bundleDir, b), 'utf8')));
    await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
    await core.call('loadVendors', {});
  });

  after(() => core?.dispose());

  test('a saved project reopens with its parts, painting, layer heights, plates, events and colors', async () => {
    await buildFeatureProject(core, fs.readFileSync(path.join(repoRoot, 'tests', 'data', '20mm_cube.obj')));
    const saved = await readProjectState(core);
    assert.equal(saved.tree.objects.length, 2, 'the clone is a second object');
    assert.ok(saved.objects[0].volumes.some((v) => v.paint.color), 'the cube has color painting');

    for (const compressionLevel of [undefined, 1, 2, 10]) {
      const file = `/out/roundtrip_${compressionLevel ?? 'default'}.3mf`;
      await core.call('saveProject', { path: file, ...(compressionLevel === undefined ? {} : { compressionLevel }) });
      await core.call('openProject', { path: file });
      assert.deepEqual(await readProjectState(core), saved, `compressionLevel ${compressionLevel ?? 'default'}`);
    }
  });

  test('saveProject rejects a compression level outside 1-10', async () => {
    for (const compressionLevel of [-1, 0, 11, 2.5, '2', null, 4294967298, -4294967294, 18446744073709551615, -9223372036854775808]) {
      await assert.rejects(core.call('saveProject', { path: '/out/bad.3mf', compressionLevel }), /compressionLevel/);
    }
    // Integers JavaScript cannot represent exactly, which must not wrap into the range.
    for (const level of ['18446744073709551615', '18446744073709551618', '4294967298', '-9223372036854775808', '-4294967294']) {
      await assert.rejects(core.call('saveProject', `{"path":"/out/bad.3mf","compressionLevel":${level}}`), /compressionLevel/);
    }
  });
});
