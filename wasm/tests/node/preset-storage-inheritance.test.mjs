import test from 'node:test';
import assert from 'node:assert/strict';
import { renameUserPreset, deleteUserPreset, loadUserPresets } from '../../app/src/presets/presetStorage.ts';
import { effectivePreset } from '../../app/src/presets/effectivePreset.ts';

test('local parent rename preserves inheritance and referenced deletion is atomic', async t => {
  const memory = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  const presets = [
    { kind: 'process', name: 'Parent', inherits: 'System', values: { layer_height: '0.16' } },
    { kind: 'process', name: 'Child', inherits: 'Parent', values: { wall_loops: '4' } },
    { kind: 'process', name: 'Grandchild', inherits: 'Child', values: { fill_density: '20%' } },
    { kind: 'filament', name: 'Parent', inherits: 'PLA', values: {} }
  ];
  memory.set('orca_user_presets', JSON.stringify(presets));
  await renameUserPreset('process', 'Parent', 'Renamed');
  const loaded = await loadUserPresets();
  assert.deepEqual(effectivePreset('process', 'Grandchild', loaded), { preset: 'System', values: { layer_height: '0.16', wall_loops: '4', fill_density: '20%' } });
  assert.equal(loaded.find(p => p.kind === 'filament').name, 'Parent');
  const before = [...memory.entries()];
  await assert.rejects(deleteUserPreset('process', 'Renamed'), /inherit/);
  assert.deepEqual([...memory.entries()], before);
  await deleteUserPreset('process', 'Grandchild');
  assert.equal((await loadUserPresets()).some(p => p.name === 'Grandchild'), false);
});
