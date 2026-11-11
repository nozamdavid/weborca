import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createManifest, verifyManifest as verify, captureIdentity } from '../scripts/runtime-manifest.mjs';

test('accept valid bundle; reject stale source and modified runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-manifest-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/engine.cpp'), 'original');
    const dir = path.join(root, 'runtime');
    const prefix = path.join(root, 'prefix');
    fs.mkdirSync(dir); fs.mkdirSync(prefix);
    fs.writeFileSync(path.join(prefix, 'dependency.h'), 'pinned');
    fs.writeFileSync(path.join(dir, 'orca_engine.mjs'), 'module');
    fs.writeFileSync(path.join(dir, 'orca_engine.wasm'), Buffer.from([0,97,115,109,1,0,0,0]));
    createManifest(root, dir, 'engine', prefix);
    const expected = captureIdentity(root, 'engine', prefix);
    fs.mkdirSync(path.join(root, 'wasm/build/runtime-identities'), { recursive: true });
    fs.writeFileSync(path.join(root, 'wasm/build/runtime-identities/engine.json'), JSON.stringify(expected));
    assert.doesNotThrow(() => verify(root, dir, 'engine'));
    const verifyManifest = (root, dir, kind) => verify(root, dir, kind, expected);
    fs.writeFileSync(path.join(prefix, 'dependency.h'), 'changed');
    assert.throws(() => verify(root, dir, 'engine', captureIdentity(root, 'engine', prefix)), /identity/);
    fs.writeFileSync(path.join(prefix, 'dependency.h'), 'pinned');
    for (const [key, value] of [['architecture', '32'], ['cFlags', '-O0'], ['toolchain', '0.0.0']]) {
      assert.throws(() => verify(root, dir, 'engine', { ...expected, build: { ...expected.build, [key]: value } }), /identity/);
      const original = fs.readFileSync(path.join(dir, 'runtime-manifest.json'), 'utf8');
      const altered = JSON.parse(original);
      altered.build[key] = value;
      fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), JSON.stringify(altered));
      assert.throws(() => verify(root, dir, 'engine'), /identity/);
      fs.writeFileSync(path.join(dir, 'runtime-manifest.json'), original);
    }
    fs.writeFileSync(path.join(root, 'src/generated.o'), 'ignored object');
    fs.writeFileSync(path.join(root, 'src/generated.log'), 'ignored log');
    assert.doesNotThrow(() => verifyManifest(root, dir, 'engine'));
    fs.mkdirSync(path.join(root, 'wasm/deps'), { recursive: true });
    fs.writeFileSync(path.join(root, 'wasm/deps/build_fixture.sh'), 'changed recipe');
    assert.throws(() => verify(root, dir, 'engine'), /configuration\/recipe/);
    fs.unlinkSync(path.join(root, 'wasm/deps/build_fixture.sh'));
    assert.doesNotThrow(() => verifyManifest(root, dir, 'engine'));
    const demo = path.join(root, 'wasm/preview/demo');
    fs.mkdirSync(demo, { recursive: true });
    fs.writeFileSync(path.join(demo, 'orca_preview.js'), 'new generated runtime');
    fs.writeFileSync(path.join(demo, 'orca_preview.wasm'), 'new generated binary');
    assert.doesNotThrow(() => verifyManifest(root, dir, 'engine'), 'Preview build outputs do not invalidate source identity');
    fs.writeFileSync(path.join(root, 'src/engine.cpp'), 'changed');
    assert.throws(() => verifyManifest(root, dir, 'engine'), /Stale/);
    fs.writeFileSync(path.join(root, 'src/engine.cpp'), 'original');
    fs.appendFileSync(path.join(dir, 'orca_engine.mjs'), 'changed');
    assert.throws(() => verifyManifest(root, dir, 'engine'), /Mismatched/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
