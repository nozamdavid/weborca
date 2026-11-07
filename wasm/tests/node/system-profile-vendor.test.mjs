import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

const bundle = await build({
  stdin: {
    contents: "export * from './systemProfiles'; export * from './effectivePreset';",
    resolveDir: new URL('../../app/src/presets/', import.meta.url).pathname, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false,
});

test('exact vendor metadata, serial fallback, cache and imported user inheritance chain', async () => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { findSystemProfileVendor, effectivePreset } = module.exports;
  const originalFetch = globalThis.fetch;
  const requested = [];
  const files = {
    Snapmaker: { 'Snapmaker/machine/base.json': JSON.stringify({ name: 'Snapmaker U1 (0.4 nozzle)' }) },
    Other: {
      'Other/process/base.json': JSON.stringify({ name: 'Snapmaker-looking process' }),
      'Other/filament/base.json': JSON.stringify({ name: 'Unbranded material' }),
    },
    Voron: {},
  };
  globalThis.fetch = async url => {
    const vendor = decodeURIComponent(url.slice('/profiles/'.length, -'.json'.length));
    requested.push(vendor);
    return { ok: true, json: async () => ({ files: files[vendor] }) };
  };
  try {
    const vendors = ['Voron', 'Other', 'Snapmaker'];
    const users = [
      { kind: 'printer', name: 'Saved', inherits: 'Snapmaker U1 (0.4 nozzle)', values: { machine_start_gcode: 'G28', z_offset: '0.125' } },
      { kind: 'printer', name: 'Child', inherits: 'Saved', values: { z_offset: '0.25' } },
    ];
    const effective = effectivePreset('printer', 'Child', users);
    assert.equal(await findSystemProfileVendor('machine', effective.preset, vendors, 'Voron'), 'Snapmaker');
    assert.deepEqual(requested, ['Snapmaker'], 'likely vendor is verified first');
    assert.deepEqual(effective.values, { machine_start_gcode: 'G28', z_offset: '0.25' });
    assert.equal(await findSystemProfileVendor('process', 'Snapmaker-looking process', vendors, 'Voron'), 'Other',
      'display prefix alone cannot identify a vendor');
    assert.deepEqual(requested, ['Snapmaker', 'Voron', 'Other']);
    assert.equal(await findSystemProfileVendor('filament', 'Unbranded material', vendors), 'Other');
    assert.equal(await findSystemProfileVendor('machine', 'Unknown parent', vendors), undefined);
    assert.equal(await findSystemProfileVendor('machine', effective.preset, vendors), 'Snapmaker');
    assert.equal(requested.length, 3, 'already cached metadata is reused across preset kinds');
  } finally { globalThis.fetch = originalFetch; }
});
