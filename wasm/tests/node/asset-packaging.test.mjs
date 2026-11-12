import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureIdentity, createManifest } from '../../scripts/runtime-manifest.mjs';
import { loadConfigFromFile } from '../../app/node_modules/vite/dist/node/index.js';

test('explicit native/catalog/layout inputs package identically in gated and static-off modes', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-packaging-'));
  const keys = ['ORCA_ENGINE_DIR', 'ORCA_STEP_MODULE_DIR', 'ORCA_PREVIEW_DIR', 'ORCA_PROFILES_DIR', 'ORCA_SETTINGS_DIR', 'ORCA_RUNTIME_IDENTITIES', 'WASM_PREFIX', 'OCCT_PREFIX'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  for (const key of keys) {
    process.env[key] = path.join(temp, key);
    fs.mkdirSync(process.env[key]);
  }
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const inputs = [
    ['ORCA_ENGINE_DIR', 'orca_engine.mjs', 'export default "engine fixture"'],
    ['ORCA_ENGINE_DIR', 'orca_engine.wasm', wasm],
    ['ORCA_STEP_MODULE_DIR', 'step_tessellate.mjs', 'export default "STEP fixture"'],
    ['ORCA_STEP_MODULE_DIR', 'step_tessellate.wasm', wasm],
    ['ORCA_PREVIEW_DIR', 'orca_preview.js', 'export default "Preview fixture"'],
    ['ORCA_PREVIEW_DIR', 'orca_preview.wasm', wasm],
    ['ORCA_PROFILES_DIR', 'index.json', '{"fixture":"catalog"}'],
    ['ORCA_SETTINGS_DIR', 'layout.json', '{"fixture":"layout"}'],
  ];
  for (const [key, file, bytes] of inputs) fs.writeFileSync(path.join(process.env[key], file), bytes);
  // Synthetic runtime bytes need matching fixture provenance, just as real builds do.
  const root = new URL('../../../', import.meta.url).pathname;
  for (const file of ['LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt']) {
    fs.writeFileSync(path.join(process.env.ORCA_STEP_MODULE_DIR, file), 'fixture license');
  }
  for (const [kind, key] of [['engine', 'ORCA_ENGINE_DIR'], ['preview', 'ORCA_PREVIEW_DIR'], ['step', 'ORCA_STEP_MODULE_DIR']]) {
    fs.writeFileSync(path.join(process.env.ORCA_RUNTIME_IDENTITIES, `${kind}.json`), JSON.stringify(captureIdentity(root, kind, process.env.WASM_PREFIX)));
    createManifest(root, process.env[key], kind, process.env.WASM_PREFIX);
  }
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, new URL('../../app/vite.config.ts', import.meta.url).pathname);
  const plugin = loaded.config.plugins.find(plugin => plugin.name === 'orca-assets-plugin');
  for (const gated of [false, true]) {
    const out = path.join(temp, gated ? 'gated' : 'off');
    fs.mkdirSync(out);
    plugin.configResolved({ root: temp, build: { outDir: out }, env: { VITE_ALPHA_GATE_ENABLED: gated ? '1' : '0' } });
    plugin.closeBundle();
    for (const [key, file] of inputs) {
      const directories = key === 'ORCA_ENGINE_DIR' ? ['engine']
        : key === 'ORCA_STEP_MODULE_DIR' ? ['engine/step']
        : key === 'ORCA_PREVIEW_DIR' ? ['', 'preview']
        : key === 'ORCA_PROFILES_DIR' ? ['profiles'] : ['', 'settings'];
      for (const directory of directories) assert.deepEqual(fs.readFileSync(path.join(out, directory, file)), fs.readFileSync(path.join(process.env[key], file)));
    }
    assert.equal(fs.existsSync(path.join(out, 'alpha-public/bootstrap.js')), gated);
    assert.equal(fs.existsSync(path.join(out, 'alpha-bootstrap.html')), gated);
  }
});
